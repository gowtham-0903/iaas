# IAAS Frontend React Skill

## When This Skill Activates
- Creating or editing any file in iaas-frontend/src/
- Creating new pages, components, API files
- Debugging React or Tailwind issues
- Writing frontend tests

## Project-Specific Rules

### Page Structure
- Every page goes in iaas-frontend/src/pages/
- Every page that needs auth wraps in ProtectedRoute in App.jsx
- Public pages (like feedback form) use plain Route, no AppShell
- Every page that needs sidebar uses AppShell wrapper
- Role-based access via allowedRoles prop on ProtectedRoute

### API Layer Rules
- Every resource has its own file in iaas-frontend/src/api/
- All calls go through axiosInstance (never raw axios)
- axiosInstance base URL: http://127.0.0.1:5001 (dev)
- withCredentials: true on all requests (JWT cookies)
- X-CSRF-TOKEN header auto-attached by interceptor
- Auto-logout on 401 via response interceptor

### State Management
- Auth state only in Zustand at src/store/authStore.js
- Local component state for form data and UI state
- No Redux, no Context API
- hasRoleAccess([roles]) checks role rank hierarchy

### Styling Rules
- Tailwind CSS only — no inline styles
- shadcn/ui components where available
- Primary blue: consistent with existing pages
- Mobile-friendly: all forms work on small screens
- Loading states required on all async operations
- Empty states required when lists have no data
- Error toasts for all failed operations

### New Route Checklist
When adding a new page:
1. Create page file in src/pages/
2. Add route in App.jsx (ProtectedRoute or plain Route)
3. Add nav item in Sidebar.jsx if it needs navigation
4. Create API file in src/api/ if new backend resource
5. Add to CLAUDE.md Section 6

### Testing Rules
- Use Vitest + React Testing Library
- Mock axiosInstance for all API tests
- Mock react-router-dom useNavigate
- Mock asset imports (images, logos)
- Test: render, interaction, API call, navigation, error state
