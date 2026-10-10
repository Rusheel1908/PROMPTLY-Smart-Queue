import { MapPinOff, MonitorPlay, Ticket } from 'lucide-react';
import { Link } from 'react-router-dom';
import { prefetchOn } from '../lib/pages';
import { Button, Empty } from './ui';

/** Any path no screen matches: say so, and point to the two public screens. */
export const NotFound = () => (
  <div className="mx-auto flex max-w-xl flex-col items-center">
    <Empty icon={MapPinOff} title="Page not found" hint="This address doesn't match any Promptly screen." />
    <div className="flex gap-3">
      <Link to="/kiosk" {...prefetchOn('/kiosk')}><Button icon={Ticket}>Kiosk</Button></Link>
      <Link to="/board" {...prefetchOn('/board')}><Button variant="ghost" icon={MonitorPlay}>Board</Button></Link>
    </div>
  </div>
);
