import { Router, Request, Response } from 'express';
import { createJsonStore } from '../../../platform/server/storage.js';
import type { SliceServer } from '../../../platform/server/slice.js';

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

const store = createJsonStore<Todo[]>('todos', []);

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await store.read());
  } catch (error) {
    console.error('Error reading todos:', error);
    res.status(500).json({ error: 'Failed to read todos' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }
    const todos = await store.read();
    const newTodo: Todo = {
      id: Date.now().toString(),
      text: text.trim(),
      completed: false,
      createdAt: new Date().toISOString(),
    };
    todos.push(newTodo);
    await store.write(todos);
    res.status(201).json(newTodo);
  } catch (error) {
    console.error('Error creating todo:', error);
    res.status(500).json({ error: 'Failed to create todo' });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { completed, text } = req.body;
    const todos = await store.read();
    const index = todos.findIndex(t => t.id === id);
    if (index === -1) return res.status(404).json({ error: 'Todo not found' });
    if (typeof completed === 'boolean') todos[index].completed = completed;
    if (typeof text === 'string') todos[index].text = text.trim();
    await store.write(todos);
    res.json(todos[index]);
  } catch (error) {
    console.error('Error updating todo:', error);
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const todos = await store.read();
    const remaining = todos.filter(t => t.id !== id);
    if (remaining.length === todos.length) {
      return res.status(404).json({ error: 'Todo not found' });
    }
    await store.write(remaining);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting todo:', error);
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

const slice: SliceServer = { router };
export default slice;
