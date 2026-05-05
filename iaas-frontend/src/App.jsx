import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import useAuthStore from './store/authStore'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ClientDashboard from './pages/ClientDashboard'
import Interviews from './pages/Interviews'
import JDManagement from './pages/JDManagement'
import SkillExtraction from './pages/SkillExtraction'
import Candidates from './pages/Candidates'
import Clients from './pages/Clients'
import FeedbackForm from './pages/FeedbackForm'
import QCReview from './pages/QCReview'
import ScoreReport from './pages/ScoreReport'
import Users from './pages/Users'
import SkillExtractionHub from './pages/SkillExtractionHub'
import PanelistSlots from './pages/PanelistSlots'
import PanelistAssignments from './pages/PanelistAssignments'

function DashboardEntry() {
  const userRole = useAuthStore((state) => state.user?.role)
  if (userRole === 'CLIENT') {
    return <Navigate to="/client-dashboard" replace />
  }
  return <Dashboard />
}

function FeedbackEntry() {
  const userRole = useAuthStore((state) => state.user?.role)
  if (userRole === 'PANELIST') {
    return <Navigate to="/slots" replace />
  }
  return <FeedbackForm />
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
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardEntry />} />
          <Route path="/client-dashboard" element={<ProtectedRoute allowedRoles={['CLIENT']}><ClientDashboard /></ProtectedRoute>} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/interviews" element={<Interviews />} />
          <Route path="/panelist-assignments" element={<ProtectedRoute allowedRoles={['ADMIN', 'M_RECRUITER', 'SR_RECRUITER', 'OPERATOR']}><PanelistAssignments /></ProtectedRoute>} />
          <Route path="/jd" element={<JDManagement />} />
          <Route path="/candidates" element={<Candidates />} />
          <Route path="/feedback" element={<FeedbackEntry />} />
          <Route path="/qc" element={<ProtectedRoute allowedRoles={['QC', 'ADMIN']}><QCReview /></ProtectedRoute>} />
          <Route path="/report" element={<ScoreReport />} />
          <Route path="/users" element={<Users />} />
          <Route path="/slots" element={<ProtectedRoute allowedRoles={['PANELIST', 'ADMIN']}><PanelistSlots /></ProtectedRoute>} />
        </Route>
        <Route path="/skill-extraction" element={<ProtectedRoute><SkillExtractionHub /></ProtectedRoute>} />
        <Route path="/skill-extraction/:jdId" element={<ProtectedRoute><SkillExtraction /></ProtectedRoute>} />
        <Route path="/jd-management" element={<Navigate to="/jd" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
