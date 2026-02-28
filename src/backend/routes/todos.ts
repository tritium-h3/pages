import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Todo types
interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

// Storage path
const TODOS_FILE = path.join(__dirname, '..', 'todos.json');

// Initialize storage
export async function initTodoStorage() {
  try {
    await fs.access(TODOS_FILE);
  } catch {
    await fs.writeFile(TODOS_FILE, JSON.stringify([], null, 2));
  }
}

// Helper functions for todo storage
async function readTodos(): Promise<Todo[]> {
  try {
    const data = await fs.readFile(TODOS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeTodos(todos: Todo[]): Promise<void> {
  await fs.writeFile(TODOS_FILE, JSON.stringify(todos, null, 2));
}

// Create router
const router = Router();

// Todo API endpoints
router.get('/todos', async (req: Request, res: Response) => {
  try {
    const todos = await readTodos();
    res.json(todos);
  } catch (error) {
    console.error('Error reading todos:', error);
    res.status(500).json({ error: 'Failed to read todos' });
  }
});

router.post('/todos', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    const todos = await readTodos();
    const newTodo: Todo = {
      id: Date.now().toString(),
      text: text.trim(),
      completed: false,
      createdAt: new Date().toISOString()
    };
    
    todos.push(newTodo);
    await writeTodos(todos);
    
    res.status(201).json(newTodo);
  } catch (error) {
    console.error('Error creating todo:', error);
    res.status(500).json({ error: 'Failed to create todo' });
  }
});

router.patch('/todos/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { completed, text } = req.body;
    
    const todos = await readTodos();
    const todoIndex = todos.findIndex(t => t.id === id);
    
    if (todoIndex === -1) {
      return res.status(404).json({ error: 'Todo not found' });
    }
    
    if (typeof completed === 'boolean') {
      todos[todoIndex].completed = completed;
    }
    if (typeof text === 'string') {
      todos[todoIndex].text = text.trim();
    }
    
    await writeTodos(todos);
    res.json(todos[todoIndex]);
  } catch (error) {
    console.error('Error updating todo:', error);
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

router.delete('/todos/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const todos = await readTodos();
    const filteredTodos = todos.filter(t => t.id !== id);
    
    if (filteredTodos.length === todos.length) {
      return res.status(404).json({ error: 'Todo not found' });
    }
    
    await writeTodos(filteredTodos);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting todo:', error);
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

export default router;
