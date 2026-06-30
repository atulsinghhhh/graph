import axios from 'axios';
import { createClient } from './supabase/client';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
});

api.interceptors.request.use(async (config) => {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  } else if (process.env.NODE_ENV === 'development') {
    config.headers['x-org-id'] = 'demo-org';
  }
  return config;
});

export default api;
