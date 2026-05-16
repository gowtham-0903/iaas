# IAAS — Interview as a Service (Design Context)

## Product Overview

IAAS (Interview as a Service) is an enterprise HRTech and recruitment operations platform built for managing the full interview lifecycle.

The platform is used by:

* Recruiters
* Senior Recruiters
* Managers
* QC Teams
* Clients
* Operators
* Interview Panelists

The system handles:

* Job descriptions
* Candidate management
* Resume parsing
* Interview scheduling
* Panelist management
* Interview scoring
* QC validation
* Client-facing result portals

This is an operational SaaS platform, not a marketing website.

Design direction:

* Enterprise-grade
* Professional
* Clean
* High information density
* Mobile-first responsive
* Modern SaaS UI
* Minimal but functional
* Production-realistic UX

Avoid:

* excessive gradients
* flashy startup aesthetics
* glassmorphism-heavy UI
* unrealistic dashboard concepts

---

# Core Workflow

Client → Job Description Created → Recruiter Assigned → Candidates Added → Resume AI Extraction → Interview Scheduled → Panelists Assigned → Feedback Submitted → AI Scoring → QC Validation → Client Views Results

---

# Tech Stack

Frontend:

* React 18
* Vite
* Tailwind CSS
* Zustand
* React Router DOM

Design System:

* Inter font
* Tailwind CSS
* Brand blue palette
* Rounded 2xl and 3xl cards
* Soft shadows
* Modern spacing system

Tailwind Design Tokens:

* Primary brand blue
* Card-based layouts
* Mobile responsive structure
* Professional enterprise aesthetic

---

# User Roles

## ADMIN

Full system management.

## RECRUITER

Manages assigned candidates and interview workflows.

## SR_RECRUITER

Creates and manages job descriptions and recruiters.

## M_RECRUITER

Oversees recruitment operations.

## QC

Reviews interview scoring and validates reports.

## CLIENT

Views approved candidate interview results.

## OPERATOR

Schedules interviews and coordinates workflows.

## PANELIST

Submits interview feedback forms.

---

# Mobile UX Priorities

The mobile experience is critical for:

* recruiters
* interview coordinators
* panelists
* QC reviewers

The UI must:

* work smoothly on phones
* support operational workflows
* reduce scrolling friction
* optimize forms for mobile use
* simplify dense data presentation

Important:
Desktop tables must become mobile-friendly card layouts.

---

# Frontend Pages

## Authentication

* Login

## Dashboards

* Dashboard
* Client Dashboard

## Job Description Management

* JD List
* Create JD
* JD Details
* Skill Extraction

## Candidate Management

* Candidate List
* Candidate Details
* Add Candidate
* Resume Upload
* Bulk Resume Upload

## Interview Management

* Interview List
* Schedule Interview
* Interview Details
* Assign Panelists

## Panelist Management

* Panelist List
* Add Panelist
* Bulk Upload Panelists

## Feedback System

* Public Feedback Form
* Coding Assessment Form

## QC & Reports

* QC Dashboard
* QC Review
* Score Reports
* Analytics

## Administration

* User Management
* Role Management

---

# Design Requirements

## General UI Style

* Premium enterprise SaaS feel
* Mobile-first responsive
* Clean spacing
* Consistent typography
* Reusable component system
* Sticky mobile navigation
* Bottom-sheet interactions where useful
* Collapsible information sections
* Clear visual hierarchy

---

# Dashboard Requirements

Dashboards should include:

* KPI metric cards
* interview pipeline summaries
* recruiter activity
* candidate status tracking
* quick action buttons
* compact analytics

Mobile dashboards should prioritize:

* quick readability
* operational efficiency
* minimal clutter

---

# Candidate Screens

Candidate screens should support:

* quick scanning
* resume status visibility
* AI extraction status
* interview progress
* compact candidate cards
* expandable metadata sections

---

# Interview Screens

Interview flows should:

* simplify scheduling
* support panelist assignment
* show timeline/status clearly
* provide mobile-friendly date and time selection
* reduce operational friction

---

# Feedback Form Requirements

Feedback forms are critical mobile workflows.

Requirements:

* optimized 5-star rating UI
* smooth long-form comment experience
* easy coding assessment input
* clear section grouping
* distraction-free submission flow

---

# QC Review Screens

QC interfaces should:

* compare AI scoring vs panelist feedback
* support validation workflows
* display structured candidate summaries
* present reports cleanly on mobile

---

# Reports & Analytics

Reports should:

* look executive-ready
* support PDF export layouts
* visualize scoring clearly
* maintain readability on smaller screens

---

# Mobile Navigation

Use:

* sticky bottom navigation
* collapsible sidebar
* contextual quick actions
* floating action buttons only when useful

Avoid:

* overcrowded menus
* excessive nested navigation

---

# Responsive Behavior

## Mobile

* stacked cards
* collapsible sections
* bottom navigation
* simplified layouts

## Tablet

* hybrid grid layouts
* sidebar support
* denser information display

## Desktop

* advanced tables
* analytics dashboards
* multi-column layouts

---

# Important Constraints

Do NOT:

* change workflows
* invent backend functionality
* redesign business logic
* remove operational complexity entirely

Do:

* improve usability
* modernize layouts
* optimize mobile ergonomics
* create production-realistic enterprise UI

The final UI should feel similar in quality to:

* modern HRTech SaaS products
* ATS platforms
* recruiter operations dashboards
* enterprise admin systems
