import { useState, useEffect } from 'react';
import { Check, X, Plus, Trash2 } from 'lucide-react';
import { apiUrl } from './backendApi';

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

export default function TodoList() {
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
      const response = await fetch(apiUrl('/todos'));
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
      const response = await fetch(apiUrl('/todos'), {
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
      const response = await fetch(apiUrl(`/todos/${id}`), {
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
      const response = await fetch(apiUrl(`/todos/${id}`), {
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-8 text-center">
            Todo List
          </h1>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Add Todo Form */}
          <form onSubmit={addTodo} className="mb-8">
            <div className="flex gap-2">
              <input
                type="text"
                value={newTodoText}
                onChange={(e) => setNewTodoText(e.target.value)}
                placeholder="What needs to be done?"
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !newTodoText.trim()}
                className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
              >
                <Plus size={20} />
                Add
              </button>
            </div>
          </form>

          {/* Active Todos */}
          {activeTodos.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-gray-700 mb-3">
                Active ({activeTodos.length})
              </h2>
              <div className="space-y-2">
                {activeTodos.map(todo => (
                  <div
                    key={todo.id}
                    className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                  >
                    <button
                      onClick={() => toggleTodo(todo.id, todo.completed)}
                      className="w-6 h-6 border-2 border-gray-400 rounded-md hover:border-indigo-600 transition-colors flex items-center justify-center"
                    >
                      {/* Empty checkbox */}
                    </button>
                    <span className="flex-1 text-gray-800">{todo.text}</span>
                    <button
                      onClick={() => deleteTodo(todo.id)}
                      className="opacity-0 group-hover:opacity-100 p-2 text-red-500 hover:bg-red-50 rounded transition-all"
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
            <div>
              <h2 className="text-lg font-semibold text-gray-700 mb-3">
                Completed ({completedTodos.length})
              </h2>
              <div className="space-y-2">
                {completedTodos.map(todo => (
                  <div
                    key={todo.id}
                    className="flex items-center gap-3 p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors group"
                  >
                    <button
                      onClick={() => toggleTodo(todo.id, todo.completed)}
                      className="w-6 h-6 bg-green-500 rounded-md hover:bg-green-600 transition-colors flex items-center justify-center"
                    >
                      <Check size={16} className="text-white" />
                    </button>
                    <span className="flex-1 text-gray-600 line-through">
                      {todo.text}
                    </span>
                    <button
                      onClick={() => deleteTodo(todo.id)}
                      className="opacity-0 group-hover:opacity-100 p-2 text-red-500 hover:bg-red-50 rounded transition-all"
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
            <div className="text-center py-12">
              <div className="text-6xl mb-4">📝</div>
              <p className="text-gray-500 text-lg">No todos yet. Add one above!</p>
            </div>
          )}

          {/* Stats */}
          {todos.length > 0 && (
            <div className="mt-8 pt-6 border-t border-gray-200 text-center text-sm text-gray-600">
              {activeTodos.length} active • {completedTodos.length} completed • {todos.length} total
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
