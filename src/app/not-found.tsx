export default function NotFound() {
  return (
    <div className="grid h-screen place-items-center bg-ink text-text">
      <div className="text-center">
        <h2 className="text-2xl font-bold">404 - Airspace Route Not Found</h2>
        <p className="mt-2 text-muted">The requested radar channel does not exist.</p>
        <a href="/" className="mt-4 inline-block rounded border border-line px-3 py-1 text-sm text-cyan hover:border-cyan">
          Return to Operations
        </a>
      </div>
    </div>
  );
}
