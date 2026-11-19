/** Small, dependency-free translation registry for low-bandwidth VSLA screens. */
export type VslaLanguage = "en" | "lg";

const copy = {
  en: {
    language: "Language",
    savings: "Savings",
    shares: "Shares",
    loanBalance: "Loan balance",
    estimatedShareout: "Estimated share-out",
    upcomingMeetings: "Upcoming meetings",
    recentSavings: "Recent savings",
    signOut: "Sign out",
  },
  lg: {
    language: "Olulimi",
    savings: "Ensimbi eziterekeddwa",
    shares: "Emigabo",
    loanBalance: "Bbanja erisigadde",
    estimatedShareout: "Okugabana okusuubirwa",
    upcomingMeetings: "Enkuŋŋaana ezijja",
    recentSavings: "Ensimbi ezaaterekebwa kumpi",
    signOut: "Fuluma",
  },
} as const;

export function vslaText(language: VslaLanguage) {
  return copy[language];
}
