/**
 * Canonical list of medical specialties used across the app.
 *
 * Single source of truth for:
 *  - StationEditor specialty dropdown
 *  - Library filter "Specialty" dropdown
 *
 * Keep alphabetised within each cluster for predictable scanning.
 * "Other" is a permitted free-text escape hatch in the editor; the filter
 * shows "Other" only as a value (matches stations whose specialty is the
 * literal word "Other" or any value not in the predefined list — currently
 * the simplest behavior, can refine later).
 */
export const SPECIALTIES = [
  // Core / generalist
  "Family Medicine",
  "Internal Medicine",
  "Pediatrics",
  "Emergency Medicine",
  "General Surgery",
  "Obstetrics & Gynecology",
  "Psychiatry",

  // IM subspecialties
  "Cardiology",
  "Endocrinology",
  "Gastroenterology",
  "Geriatrics",
  "Hematology / Oncology",
  "Infectious Disease",
  "Nephrology",
  "Pulmonology",
  "Rheumatology",

  // Surgical / procedural
  "Anesthesiology",
  "Cardiothoracic Surgery",
  "Neurosurgery",
  "Orthopedics",
  "Otolaryngology (ENT)",
  "Plastic Surgery",
  "Urology",
  "Vascular Surgery",

  // Other clinical
  "Dermatology",
  "Neurology",
  "Ophthalmology",
  "Pathology",
  "Physiatry / PM&R",
  "Radiology",

  "Other",
] as const;

export type Specialty = (typeof SPECIALTIES)[number];
