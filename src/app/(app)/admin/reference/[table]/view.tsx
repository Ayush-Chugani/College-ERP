'use client';

import { useMemo } from 'react';
import { RecordEditor, refApi } from '@/features/record-editor';

export function ReferenceView({ table }: { table: string }) {
  const api = useMemo(() => refApi(table), [table]);
  return <RecordEditor api={api} />;
}
