# IAAS System - Roles & Access Control Guide

## Overview
The Interview Assessment System (IAAS) has 7 distinct user roles with hierarchical permissions. This document outlines each role and their access levels.

---

## Role Hierarchy & Access Matrix

### 1. **ADMIN** - Administrator
**Access Level:** Full System Access
- ✅ Complete system access to all features
- ✅ User management (create, edit, delete users)
- ✅ System configuration & settings
- ✅ All reporting and analytics
- ✅ Can manage all candidates, JDs, clients
- ✅ Can override any system controls
- ✅ Access to all interview feedback and scoring

**Use Case:** System administrators and platform owners

---

### 2. **M_RECRUITER** - Manager Recruiter
**Access Level:** High-Level Recruiter Management & Oversight
- ✅ Manage and supervise recruiters
- ✅ Manage candidates (create, assign, view all candidates)
- ✅ Create and edit job descriptions
- ✅ Download/export recruitment reports
- ✅ Assign candidates to interviews
- ✅ View interview schedules and feedback
- ✅ Access to analytics dashboard
- ✅ Cannot manage system settings or users

**Use Case:** Recruitment team leads and managers

---

### 3. **SR_RECRUITER** - Senior Recruiter
**Access Level:** Advanced Recruiter Features
- ✅ Manage candidates assigned to them
- ✅ Create and edit job descriptions
- ✅ Conduct candidate screening
- ✅ Schedule interviews for candidates
- ✅ View recruitment analytics for their team
- ✅ Manage candidate status and feedback
- ✅ Generate reports on recruitment pipeline
- ❌ Cannot manage other recruiters
- ❌ Cannot access system configuration

**Use Case:** Experienced recruiters with supervisory tasks

---

### 4. **RECRUITER** - Junior/Standard Recruiter
**Access Level:** Basic Recruitment Operations
- ✅ View assigned candidates
- ✅ Update candidate information
- ✅ Search job descriptions
- ✅ Schedule interviews (with approval in some workflows)
- ✅ View assigned interview schedules
- ✅ Submit candidate feedback
- ❌ Cannot create job descriptions
- ❌ Cannot manage other users
- ❌ Cannot access advanced analytics

**Use Case:** Entry-level and standard recruiters

---

### 5. **PANELIST** - Interview Panelist
**Access Level:** Interview & Feedback Only
- ✅ View assigned interviews
- ✅ Conduct interviews
- ✅ Provide structured feedback & scoring
- ✅ View candidate profiles (for assigned interviews only)
- ✅ Submit assessment results
- ✅ View common evaluation rubrics
- ❌ Cannot manage candidates or JDs
- ❌ Cannot access candidate database beyond assigned interviews
- ❌ Cannot modify interview schedules

**Use Case:** Subject matter experts, technical reviewers, hiring managers

---

### 6. **QC** - Quality Control
**Access Level:** Review & Audit Operations
- ✅ View all feedback and assessments
- ✅ Review interview recordings/notes
- ✅ Audit scoring accuracy
- ✅ Generate quality control reports
- ✅ Flag inconsistencies or issues
- ✅ Download compliance reports
- ❌ Cannot modify candidates or interviews
- ❌ Cannot change assessments (read-only access)
- ❌ Cannot manage users

**Use Case:** Quality assurance and compliance officers

---

### 7. **CLIENT** - Client Portal User
**Access Level:** Limited Client View
- ✅ View assigned candidates
- ✅ View job status for their company
- ✅ Receive notifications on updates
- ✅ Download finalized reports for their requests
- ✅ View interview assessments for their candidates
- ❌ Cannot create or modify anything
- ❌ Cannot see other clients' information
- ❌ Cannot access internal system controls

**Use Case:** External clients and stakeholders

---

## Feature Access Table

| Feature | ADMIN | M_RECRUITER | SR_RECRUITER | RECRUITER | PANELIST | QC | CLIENT |
|---------|:-----:|:-----------:|:----:|:---------:|:--------:|:--:|:------:|
| **User Management** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Create Users** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **System Settings** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Create JD** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Manage Candidates** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ⚠️ Limited |
| **Schedule Interviews** | ✅ | ✅ | ✅ | ⚠️ Limited | ❌ | ❌ | ❌ |
| **Conduct Interviews** | ✅ | ✅ | ⚠️ Limited | ❌ | ✅ | ❌ | ❌ |
| **Provide Feedback** | ✅ | ✅ | ⚠️ Limited | ✅ | ✅ | ❌ | ❌ |
| **View Reports** | ✅ | ✅ | ✅ | ⚠️ Limited | ⚠️ Limited | ✅ | ⚠️ Limited |
| **Audit/QC** | ✅ | ⚠️ Limited | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Export Data** | ✅ | ✅ | ✅ | ⚠️ Limited | ❌ | ✅ | ⚠️ Limited |

**Legend:** 
- ✅ = Full Access
- ❌ = No Access  
- ⚠️ = Limited Access (context-dependent)

---

## Default User Settings

- **Default Role:** RECRUITER (when creating new users without specifying a role)
- **Default Status:** ACTIVE
- **Password Requirements:** 
  - Minimum 8 characters
  - At least 1 uppercase letter
  - At least 1 lowercase letter
  - At least 1 number
  - At least 1 special character

---

## Role Change Recommendations

### Promotion Path
```
RECRUITER → SR_RECRUITER → M_RECRUITER → ADMIN
```

### Role Selection Guide

**For Candidate Pipeline:**
- Entry-level staff: **RECRUITER**
- Experienced recruiters: **SR_RECRUITER**
- Recruitment managers: **M_RECRUITER**

**For Interview Assessment:**
- Technical interviewers: **PANELIST**
- Hiring managers: **PANELIST**

**For Quality:**
- Compliance officer: **QC**
- Process owner: **M_RECRUITER** or **ADMIN**

**For Oversight:**
- Platform owner: **ADMIN**
- System manager: **ADMIN**

**For External Partners:**
- Partner organizations: **CLIENT** (isolated view)

---

## How to Add Users

1. Navigate to **Reports → Users** in the sidebar
2. Click **Add New User** button
3. Fill in the form:
   - **Full Name:** User's complete name
   - **Email:** Unique email address
   - **Password:** Must meet complexity requirements (shown on form)
   - **Role:** Select appropriate role from dropdown
   - **Active:** Toggle to enable/disable the user
4. Click **Create User**

### Password Requirements Reminder
When creating users, ensure passwords contain:
- ✓ Minimum 8 characters
- ✓ At least one uppercase letter (A-Z)
- ✓ At least one lowercase letter (a-z)
- ✓ At least one number (0-9)
- ✓ At least one special character (!@#$%^&*)

---

## Security Best Practices

1. **Assign Least Privilege:** Use the lowest role required for job function
2. **Regular Audits:** Periodically review user roles and access levels
3. **Disable Inactive Users:** Deactivate users who are no longer active
4. **Monitor Admin Access:** Limit the number of ADMIN users
5. **Role Isolation:** CLIENT users see only their own data
6. **Password Policy:** Enforce strong passwords (required for all new users)

---

## Current Demo Users

### System Users (Pre-seeded)
| Name | Email | Role | Password |
|------|-------|------|----------|
| Admin User | admin@meedenlabs.com | ADMIN | admin@#1234 |

---

## API Endpoints for Role Management

### List All Users
```
GET /api/users
Authorization: Bearer {token}
```

### Create New User
```
POST /api/users
Content-Type: application/json
Authorization: Bearer {token}

{
  "full_name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "role": "RECRUITER",
  "is_active": true
}
```

### Get User Details
```
GET /api/auth/me
Authorization: Bearer {token}
```

---

## FAQ

**Q: Can a RECRUITER create candidates?**
A: Yes, RECRUITER role can create and manage assigned candidates but cannot manage job descriptions.

**Q: What can a PANELIST do besides interviews?**
A: PANELIST users have read-only access to candidate profiles for interviews they're assigned to. Their primary function is conducting interviews and providing feedback.

**Q: Can CLIENT users see other clients' data?**
A: No. CLIENT accounts are isolated and can only see data belonging to their organization.

**Q: How many ADMIN users should we have?**
A: Best practice is to have 2-3 ADMIN users for backup/succession planning. Most operations should be done by M_RECRUITER or lower roles.

**Q: Can roles be changed after user creation?**
A: Yes, ADMIN users can modify user roles through user management (future implementation).

---

**Document Version:** 1.0  
**Last Updated:** April 2026  
**System:** Interview Assessment System (IAAS)
