export type Notice = { error: boolean; text: string } | null;

export function NoticeLine({ notice }: { notice: Notice | undefined }) {
  if (notice === null || notice === undefined) return null;
  return (
    <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'error' : 'ok'}>
      {notice.text}
    </p>
  );
}
