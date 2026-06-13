export default function Loading() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "linear-gradient(180deg, #02040f 0%, #050a24 45%, #0a1340 100%)" }}
    >
      <div className="flex gap-1.5">
        <span className="w-2 h-2 rounded-full bg-amber-300/80 animate-bounce [animation-delay:-0.3s]" />
        <span className="w-2 h-2 rounded-full bg-amber-300/80 animate-bounce [animation-delay:-0.15s]" />
        <span className="w-2 h-2 rounded-full bg-amber-300/80 animate-bounce" />
      </div>
    </div>
  );
}
