;

export async function GET() {
  // App uses Firestore directly from the client; no backend DB to check.
  return Response.json({ ok: true });
}
