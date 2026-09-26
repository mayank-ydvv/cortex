import { checkDb } from '../src/db/stats';
import { Chat } from './_components/chat';
import { SetupNotice } from './_components/setup-notice';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const db = await checkDb();
  if (!db.configured || !db.reachable) return <SetupNotice error={db.error} />;
  return <Chat />;
}
