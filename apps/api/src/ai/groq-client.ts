import Groq from 'groq-sdk';

export function getGroqClient(): Groq {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set — add it to apps/api/.env');
  }
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}
