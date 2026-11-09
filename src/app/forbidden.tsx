import Link from "next/link";

export default function Forbidden() {
  return (
    <main style={{ maxWidth: 520 }}>
      <h1>403 · Not available</h1>
      <p>This page is only for admins. If you think you should have access, ask an admin.</p>
      <Link className="btn" href="/">Back to home</Link>
    </main>
  );
}
