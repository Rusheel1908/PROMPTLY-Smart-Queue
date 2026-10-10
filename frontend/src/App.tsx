import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { StaffGate, StaffProvider } from './components/StaffGate';
import { ToastProvider } from './components/ui';
import Board from './pages/Board';
import Counter from './pages/Counter';
import Kiosk from './pages/Kiosk';
import Lab from './pages/Lab';
import Ops from './pages/Ops';
import Status from './pages/Status';

export default function App() {
  return (
    <ToastProvider>
      <StaffProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Kiosk />} />
            <Route path="/counter" element={<StaffGate title="Counter console"><Counter /></StaffGate>} />
            <Route path="/board" element={<Board />} />
            <Route path="/status/:id" element={<Status />} />
            <Route path="/ops" element={<StaffGate title="Supervisor ops" need="staff-stats"><Ops /></StaffGate>} />
            <Route path="/lab" element={<Lab />} />
          </Routes>
        </Layout>
      </StaffProvider>
    </ToastProvider>
  );
}
