import { NavLink, Route, Routes } from 'react-router-dom';
import Kiosk from './pages/Kiosk';
import Counter from './pages/Counter';
import Board from './pages/Board';
import Status from './pages/Status';
import Ops from './pages/Ops';

const links = [['/', 'Kiosk'], ['/counter', 'Counter'], ['/board', 'Board'], ['/ops', 'Ops']] as const;

export default function App() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="flex gap-4 bg-navy px-6 py-3 text-white">
        <span className="font-bold">Promptly</span>
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'text-yellow-300' : '')}>{label}</NavLink>
        ))}
      </nav>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<Kiosk />} />
          <Route path="/counter" element={<Counter />} />
          <Route path="/board" element={<Board />} />
          <Route path="/status/:id" element={<Status />} />
          <Route path="/ops" element={<Ops />} />
        </Routes>
      </main>
    </div>
  );
}
