import { useState, useEffect } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { apiUrl } from '../../platform/backendApi.js';
import type { ExperimentPageProps } from '../../platform/manifest.js';
import type { Todo } from './types.js';
import styles from './todo.module.css';

export default function TodoPage(_props: ExperimentPageProps) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodoText, setNewTodoText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load todos on mount
  useEffect(() => {
    loadTodos();
  }, []);

  const loadTodos = async () => {
    try {
      const response = await fetch(apiUrl('todo', '/'));
      if (!response.ok) throw new Error('Failed to load todos');
      const data = await response.json();
      setTodos(data);
      setError(null);
    } catch (err) {
      setError('Failed to load todos. Make sure the backend is running.');
      console.error(err);
    }
  };

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodoText.trim()) return;

    setLoading(true);
    try {
      const response = await fetch(apiUrl('todo', '/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newTodoText })
      });

      if (!response.ok) throw new Error('Failed to create todo');
      
      const newTodo = await response.json();
      setTodos([...todos, newTodo]);
      setNewTodoText('');
      setError(null);
    } catch (err) {
      setError('Failed to add todo');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const toggleTodo = async (id: string, completed: boolean) => {
    try {
      const response = await fetch(apiUrl('todo', `/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !completed })
      });

      if (!response.ok) throw new Error('Failed to update todo');
      
      const updatedTodo = await response.json();
      setTodos(todos.map(t => t.id === id ? updatedTodo : t));
      setError(null);
    } catch (err) {
      setError('Failed to update todo');
      console.error(err);
    }
  };

  const deleteTodo = async (id: string) => {
    try {
      const response = await fetch(apiUrl('todo', `/${id}`), {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete todo');
      
      setTodos(todos.filter(t => t.id !== id));
      setError(null);
    } catch (err) {
      setError('Failed to delete todo');
      console.error(err);
    }
  };

  const activeTodos = todos.filter(t => !t.completed);
  const completedTodos = todos.filter(t => t.completed);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          Todo List
        </h1>

        {error && (
          <div className={styles.error}>
            {error}
          </div>
        )}

        {/* Add Todo Form */}
        <form onSubmit={addTodo} className={styles.form}>
          <input
            type="text"
            value={newTodoText}
            onChange={(e) => setNewTodoText(e.target.value)}
            placeholder="What needs to be done?"
            className={styles.input}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !newTodoText.trim()}
            className={styles.addButton}
          >
            <Plus size={20} />
            Add
          </button>
        </form>

        {/* Active Todos */}
        {activeTodos.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Active ({activeTodos.length})
            </h2>
            <div className={styles.list}>
              {activeTodos.map(todo => (
                <div
                  key={todo.id}
                  className={styles.item}
                >
                  <button
                    onClick={() => toggleTodo(todo.id, todo.completed)}
                    className={styles.checkbox}
                    aria-label="Mark todo complete"
                  >
                    {/* Empty checkbox */}
                  </button>
                  <span className={styles.text}>{todo.text}</span>
                  <button
                    onClick={() => deleteTodo(todo.id)}
                    className={styles.deleteButton}
                    aria-label="Delete todo"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed Todos */}
        {completedTodos.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Completed ({completedTodos.length})
            </h2>
            <div className={styles.list}>
              {completedTodos.map(todo => (
                <div
                  key={todo.id}
                  className={`${styles.item} ${styles.itemDone}`}
                >
                  <button
                    onClick={() => toggleTodo(todo.id, todo.completed)}
                    className={`${styles.checkbox} ${styles.checkboxDone}`}
                    aria-label="Mark todo incomplete"
                  >
                    <Check size={16} className={styles.checkIcon} />
                  </button>
                  <span className={styles.text}>
                    {todo.text}
                  </span>
                  <button
                    onClick={() => deleteTodo(todo.id)}
                    className={styles.deleteButton}
                    aria-label="Delete todo"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {todos.length === 0 && !error && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📝</div>
            <p className={styles.emptyText}>No todos yet. Add one above!</p>
          </div>
        )}

        {/* Stats */}
        {todos.length > 0 && (
          <div className={styles.stats}>
            {activeTodos.length} active • {completedTodos.length} completed • {todos.length} total
          </div>
        )}
      </div>
    </div>
  );
}
