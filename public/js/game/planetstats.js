export const planetCreditValue = p => p?.statCreditValue ?? p?.type.num('Planet_Credit_Value', 0) ?? 0;
export const planetPolitics = p => p?.statPolitical ?? p?.type.num('Political_Control', 0) ?? 0;
export const planetMaxStarbase = (p, fallback = 5) => p?.statMaxStarbase ?? p?.type.num('Max_Space_Base', fallback) ?? fallback;
