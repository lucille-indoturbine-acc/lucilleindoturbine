import { connection, NextResponse } from 'next/server';

import { getActiveProjectId } from '@/lib/projects';

/**
 * Which project is open for this browser, nothing else. The sidebar card asks
 * on every navigation and whenever the tab comes back: it lives in the root
 * layout, which the client router keeps across navigations, so a project opened
 * in ANOTHER TAB moved the page under it while the card kept naming the old one
 * (19 Nov 2026: Dashboard on "[DUMMY] Overhaul GTG Unit 2", card on "asdasd").
 */
export async function GET() {
  await connection();
  return NextResponse.json({ id: await getActiveProjectId() }, { headers: { 'Cache-Control': 'no-store' } });
}
