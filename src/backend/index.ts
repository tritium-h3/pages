import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';

// Import route modules
import todosRouter, { initTodoStorage } from './routes/todos.js';
import llmDuoChatRouter, { initLLMDuoChatWebSocket } from './routes/llm-duo-chat.js';
import wikipediaStoryRouter from './routes/wikipedia-story.js';
import spriteGroupsRouter from './routes/sprite-groups.js';

const app: Express = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 5174;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://samarkand.hopto.org',
    'http://samarkand.hopto.org:5173',
    'http://samarkand.hopto.org:5174',
    'https://samarkand.hopto.org',
    'https://samarkand.hopto.org:5173',
    'https://samarkand.hopto.org:5174',
    'http://torment-nexus.local',
    'http://torment-nexus.local:5173',
    'http://torment-nexus.local:5174',
    'https://torment-nexus.local',
    'https://torment-nexus.local:5173',
    'https://torment-nexus.local:5174'
  ],
  credentials: true
}));
app.use(express.json());

// Logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.get('origin')}`);
  next();
});

// Health check routes
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api', (req: Request, res: Response) => {
  res.json({ message: 'Backend API is running' });
});

// Mount application routes
app.use('/api', todosRouter);
app.use('/api', llmDuoChatRouter);
app.use('/api', wikipediaStoryRouter);
app.use('/api', spriteGroupsRouter);

// Error handling
app.use((err: Error, req: Request, res: Response) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Create HTTP server for both Express and WebSocket
const server = http.createServer(app);

// Initialize WebSocket server for LLM Duo Chat
initLLMDuoChatWebSocket(server);

// Initialize storage and start server
initTodoStorage().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
    console.log(`WebSocket server ready at ws://0.0.0.0:${PORT}/ws/llm-duo-chat`);
  });
});
