import { Router, Response } from 'express';
import { getSupabase } from '../config/postgres';
import { authMiddleware, AuthedRequest } from '../middleware/auth';
import { runIncidentAgent } from '../ai/agent';

const router = Router();
router.use(authMiddleware as any);

router.post('/', async (req: AuthedRequest, res: Response) => {
  const { question, sessionId } = req.body as { question: string; sessionId: string };

  if (!question?.trim()) {
    res.status(400).json({ error: 'question is required' });
    return;
  }
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId is required' });
    return;
  }

  const { orgId, id: userId } = req.user!;
  const supabase = getSupabase();

  // Load last 10 messages for conversation context
  let history: { role: 'user' | 'assistant'; content: string }[] = [];
  try {
    const { data: messages } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('org_id', orgId)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(10);
    history = (messages ?? []) as typeof history;
  } catch {
    // non-fatal
  }

  // Persist the user message
  try {
    await supabase.from('chat_messages').insert({
      org_id: orgId,
      user_id: userId,
      session_id: sessionId,
      role: 'user',
      content: question,
    });
  } catch {
    // non-fatal — dev mode may lack a real user_id FK
  }

  // Run the agent
  let answer: string;
  let cypherQuery: string;
  let sources: any[];

  try {
    ({ answer, cypherQuery, sources } = await runIncidentAgent(question, orgId, history));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
    return;
  }

  // Persist the assistant response
  try {
    await supabase.from('chat_messages').insert({
      org_id: orgId,
      user_id: userId,
      session_id: sessionId,
      role: 'assistant',
      content: answer,
      sources,
      cypher_query: cypherQuery,
    });
  } catch {
    // non-fatal
  }

  res.json({ answer, sources, cypherQuery });
});

router.get('/history/:sessionId', async (req: AuthedRequest, res: Response) => {
  const { sessionId } = req.params;
  const { orgId } = req.user!;
  const supabase = getSupabase();

  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, role, content, sources, cypher_query, created_at')
      .eq('org_id', orgId)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    res.json(data ?? []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
