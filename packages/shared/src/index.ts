// Base properties every graph node shares
export interface BaseNode {
  id: string;
  orgId: string;
  source: 'github' | 'jira' | 'datadog';
  syncedAt: string;
}

export interface DeploymentNode extends BaseNode {
  version: string;
  environment: string;
  deployedAt: string;
  status: 'success' | 'failed' | 'rolled_back';
  repoName: string;
  url?: string;
}

export interface PullRequestNode extends BaseNode {
  githubId: number;
  title: string;
  body?: string;
  diffSummary?: string;
  mergedAt?: string;
  branch: string;
  repoName: string;
  url: string;
  changedFiles: string[];
}

export interface EngineerNode extends BaseNode {
  name: string;
  email: string;
  githubLogin: string;
  avatarUrl?: string;
  team?: string;
}

export interface ServiceNode extends BaseNode {
  name: string;
  repoUrl: string;
  language?: string;
  description?: string;
}

export interface IncidentNode extends BaseNode {
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  startedAt: string;
  resolvedAt?: string;
  status: 'open' | 'resolved' | 'investigating';
  description?: string;
  datadogId?: string;
}

export interface BugNode extends BaseNode {
  jiraId: string;
  title: string;
  priority: string;
  status: string;
  assigneeId?: string;
  createdAt: string;
  url: string;
}

export interface AlertNode extends BaseNode {
  datadogId: string;
  metric: string;
  message: string;
  threshold?: number;
  value?: number;
  firedAt: string;
  status: 'triggered' | 'resolved' | 'no_data';
}

// API response types
export interface HealthResponse {
  status: 'ok' | 'degraded';
  services: {
    neo4j: string;
    postgres: string;
    redis: string;
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: CitedSource[];
  cypherQuery?: string;
}

export interface CitedSource {
  type: string;
  id: string;
  label: string;
  url?: string;
}
