import { Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PageBoundary } from './components/PageBoundary';
import { StaffGate, StaffProvider } from './components/StaffGate';
import { PageLoader, ToastProvider } from './components/ui';
import { Pages } from './lib/pages';

const { Board, Counter, Kiosk, Lab, Ops, Status } = Pages;

export default function App() {
  return (
    <ToastProvider>
      <StaffProvider>
        <Layout>
          <PageBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Kiosk />} />
                <Route path="/counter" element={<StaffGate title="Counter console"><Counter /></StaffGate>} />
                <Route path="/board" element={<Board />} />
                <Route path="/status/:id" element={<Status />} />
                <Route path="/ops" element={<StaffGate title="Supervisor ops" need="staff-stats"><Ops /></StaffGate>} />
                <Route path="/lab" element={<Lab />} />
              </Routes>
            </Suspense>
          </PageBoundary>
        </Layout>
      </StaffProvider>
    </ToastProvider>
  );
}
