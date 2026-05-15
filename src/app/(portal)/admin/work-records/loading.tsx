export default function Loading() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 flex items-center justify-center">
      <div className="flex gap-1.5">
        <span className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600 animate-bounce [animation-delay:-0.3s]" />
        <span className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600 animate-bounce [animation-delay:-0.15s]" />
        <span className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600 animate-bounce" />
      </div>
    </div>
  );
}
