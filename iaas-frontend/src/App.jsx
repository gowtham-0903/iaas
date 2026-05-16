import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import useAuthStore from './store/authStore'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ClientDashboard from './pages/ClientDashboard'
import Interviews from './pages/Interviews'
import JDManagement from './pages/JDManagement'
import Candidates from './pages/Candidates'
import Clients from './pages/Clients'
import FeedbackForm from './pages/FeedbackForm'
import QCReview from './pages/QCReview'
import ScoreReport from './pages/ScoreReport'
import InterviewReport from './pages/InterviewReport'
import Users from './pages/Users'
import PanelistSlots from './pages/PanelistSlots'
import Panelists from './pages/Panelists'
import SkillExtraction from './pages/SkillExtraction'
import CalendarPage from './pages/CalendarPage'

function DashboardEntry() {
  const userRole = useAuthStore((state) => state.user?.role)
  if (userRole === 'CLIENT') {
    return <Navigate to="/client-dashboard" replace />
  }
  return <Dashboard />
}

export default function App() {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        {/* Public route — no auth required */}
        <Route path="/feedback/:token" element={<FeedbackForm />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardEntry />} />
          <Route path="/client-dashboard" element={<ProtectedRoute allowedRoles={['CLIENT']}><ClientDashboard /></ProtectedRoute>} />
          <Route path="/clients" element={<ProtectedRoute allowedRoles={['ADMIN']}><Clients /></ProtectedRoute>} />
          <Route path="/interviews" element={<Interviews />} />
          <Route path="/panelists" element={<ProtectedRoute allowedRoles={['ADMIN']}><Panelists /></ProtectedRoute>} />
          <Route path="/jd" element={<JDManagement />} />
          <Route path="/candidates" element={<Candidates />} />
          <Route path="/qc" element={<ProtectedRoute allowedRoles={['QC', 'ADMIN']}><QCReview /></ProtectedRoute>} />
          <Route path="/report" element={<ScoreReport />} />
          <Route path="/report/:interviewId" element={<InterviewReport />} />
          <Route path="/users" element={<Users />} />
          <Route path="/slots" element={<ProtectedRoute allowedRoles={['PANELIST', 'ADMIN']}><PanelistSlots /></ProtectedRoute>} />
          <Route path="/skill-extraction/:jdId" element={<SkillExtraction />} />
          <Route path="/calendar" element={<CalendarPage />} />
        </Route>
        <Route path="/jd-management" element={<Navigate to="/jd" replace />} />
        <Route path="/skill-extraction" element={<Navigate to="/jd" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
