// Standard demographic dimensions (campaign owners tick which to record).
// Every dimension is always OPTIONAL for respondents ("Prefer not to say" default),
// and every cut is threshold-protected exactly like stakeholder groups.

export const DEMO_DIMS = [
  { id: "gender", label: "Gender", question: "How do you identify?", options: ["Female", "Male", "Non-binary / other"], custom: false },
  { id: "tenure", label: "Time with the organisation", question: "How long have you been with the organisation?", options: ["Less than 1 year", "1–3 years", "4–7 years", "8–15 years", "More than 15 years"], custom: false },
  { id: "department", label: "Department / team", question: "Which department or team do you work in?", options: [], custom: true, placeholder: "e.g. Operations, Sales, Engineering, Head office" },
  { id: "qualification", label: "Highest qualification", question: "What is your highest qualification?", options: ["Matric / school", "Certificate / diploma", "Bachelor's degree", "Honours degree", "Master's or higher"], custom: false },
  { id: "age", label: "Age group", question: "Which age group are you in?", options: ["18–24", "25–34", "35–44", "45–54", "55+"], custom: false },
  { id: "language", label: "Home language", question: "What is your home language?", options: ["English", "Afrikaans", "isiZulu", "isiXhosa", "Sesotho", "Other"], custom: true, placeholder: "Comma-separated languages" },
  { id: "work_arrangement", label: "Work arrangement", question: "How do you mostly work?", options: ["Office-based", "Hybrid", "Remote", "Field-based"], custom: false },
  { id: "employment_type", label: "Employment type", question: "What is your employment type?", options: ["Permanent", "Contract", "Temporary"], custom: false },
];

export const dimById = (id) => DEMO_DIMS.find((d) => d.id === id);
