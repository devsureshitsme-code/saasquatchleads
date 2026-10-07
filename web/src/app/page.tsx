import { Suspense } from 'react';
import { App } from '@/components/App';

export default function Page() {
  return (
    <Suspense>
      <App />
    </Suspense>
  );
}
