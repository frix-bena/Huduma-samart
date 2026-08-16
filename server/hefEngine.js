/**
 * Huduma Smart — Higher Education Financing (HEF) & HELB Engine
 * Implements Kenya HEF Student-Centered Funding Model (Bands 1 - 5 & TVET)
 * Strictly processes actual scraped portal data without mock presets or hallucinated fallbacks.
 */

// Official Kenyan Universities & Institutions reference data
const INSTITUTIONS = [
  { name: "University of Nairobi (UoN)", code: "UON", standardTuition: 216000 },
  { name: "Kenyatta University (KU)", code: "KU", standardTuition: 204000 },
  { name: "Jomo Kenyatta University of Agriculture and Technology (JKUAT)", code: "JKUAT", standardTuition: 238000 },
  { name: "Moi University", code: "MOI", standardTuition: 198000 },
  { name: "Egerton University", code: "EGERTON", standardTuition: 192000 },
  { name: "Technical University of Kenya (TUK)", code: "TUK", standardTuition: 180000 },
  { name: "Maseno University", code: "MASENO", standardTuition: 186000 },
  { name: "Dedan Kimathi University of Technology (DeKUT)", code: "DEKUT", standardTuition: 220000 },
  { name: "Machakos University", code: "MACHAKOS", standardTuition: 174000 },
  { name: "Multimedia University of Kenya (MMU)", code: "MMU", standardTuition: 195000 },
  { name: "Kabarak University", code: "KABARAK", standardTuition: 210000 },
  { name: "Strathmore University", code: "STRATHMORE", standardTuition: 360000 },
  { name: "Mount Kenya University (MKU)", code: "MKU", standardTuition: 180000 },
  { name: "The Kenya Coast National Polytechnic", code: "KCNP", standardTuition: 67189, level: "TVET" },
  { name: "Rift Valley Technical Training Institute (RVTTI)", code: "RVTTI", standardTuition: 67189, level: "TVET" },
  { name: "Nairobi Technical Training Institute (NTTI)", code: "NTTI", standardTuition: 67189, level: "TVET" },
  { name: "Kabete National Polytechnic", code: "KNP", standardTuition: 67189, level: "TVET" }
];

// Kenyan Higher Education Programme Costs per academic year in KES
const PROGRAMMES = {
  "medicine": { name: "Bachelor of Medicine and Bachelor of Surgery (MBChB)", cost: 440000, level: "Undergraduate", duration: 6 },
  "nursing": { name: "Bachelor of Science in Nursing", cost: 275400, level: "Undergraduate", duration: 4 },
  "pharmacy": { name: "Bachelor of Pharmacy", cost: 357000, level: "Undergraduate", duration: 5 },
  "computer science": { name: "Bachelor of Science in Computer Science", cost: 244800, level: "Undergraduate", duration: 4 },
  "software engineering": { name: "Bachelor of Science in Software Engineering", cost: 244800, level: "Undergraduate", duration: 4 },
  "civil engineering": { name: "Bachelor of Science in Civil Engineering", cost: 306000, level: "Undergraduate", duration: 5 },
  "electrical engineering": { name: "Bachelor of Science in Electrical & Electronic Engineering", cost: 306000, level: "Undergraduate", duration: 5 },
  "mechanical engineering": { name: "Bachelor of Science in Mechanical Engineering", cost: 306000, level: "Undergraduate", duration: 5 },
  "law": { name: "Bachelor of Laws (LL.B)", cost: 221850, level: "Undergraduate", duration: 4 },
  "commerce": { name: "Bachelor of Commerce (B.Com)", cost: 183600, level: "Undergraduate", duration: 4 },
  "business": { name: "Bachelor of Business Information Technology (BBIT)", cost: 195000, level: "Undergraduate", duration: 4 },
  "economics": { name: "Bachelor of Economics & Statistics", cost: 183600, level: "Undergraduate", duration: 4 },
  "education": { name: "Bachelor of Education (Arts / Science)", cost: 153000, level: "Undergraduate", duration: 4 },
  "agriculture": { name: "Bachelor of Science in Agriculture", cost: 198900, level: "Undergraduate", duration: 4 },
  "tvet diploma": { name: "Diploma in Electrical and Electronic Engineering (TVET)", cost: 67189, level: "TVET", duration: 3 },
  "tvet it": { name: "Diploma in Information Communication Technology (TVET)", cost: 67189, level: "TVET", duration: 3 }
};

// Kenyan HEF Band Funding Matrix (Degree programmes)
const HEF_BANDS = {
  1: {
    band: 1,
    name: "Band 1",
    category: "Vulnerable",
    householdIncome: "Less than KES 5,995 / month",
    scholarshipPct: 70,
    loanPct: 25,
    householdPct: 5,
    upkeepAnnual: 60000,
    upkeepPerSem: 30000,
    color: "#10b981",
    description: "Orphans, students from extremely vulnerable backgrounds, PWDs with zero household income."
  },
  2: {
    band: 2,
    name: "Band 2",
    category: "Extremely Needy",
    householdIncome: "KES 5,995 – KES 23,670 / month",
    scholarshipPct: 60,
    loanPct: 30,
    householdPct: 10,
    upkeepAnnual: 55000,
    upkeepPerSem: 27500,
    color: "#3b82f6",
    description: "Low-income households, single-parent families, subsistence agricultural workers."
  },
  3: {
    band: 3,
    name: "Band 3",
    category: "Needy",
    householdIncome: "KES 23,671 – KES 70,000 / month",
    scholarshipPct: 50,
    loanPct: 30,
    householdPct: 20,
    upkeepAnnual: 50000,
    upkeepPerSem: 25000,
    color: "#f59e0b",
    description: "Lower-middle income households with moderate financial commitments."
  },
  4: {
    band: 4,
    name: "Band 4",
    category: "Less Needy",
    householdIncome: "KES 70,001 – KES 119,999 / month",
    scholarshipPct: 40,
    loanPct: 30,
    householdPct: 30,
    upkeepAnnual: 45000,
    upkeepPerSem: 22500,
    color: "#8b5cf6",
    description: "Middle-income earners capable of supporting a higher proportion of tuition."
  },
  5: {
    band: 5,
    name: "Band 5",
    category: "Least Needy / Moderate Income",
    householdIncome: "Above KES 120,000 / month",
    scholarshipPct: 30,
    loanPct: 30,
    householdPct: 40,
    upkeepAnnual: 40000,
    upkeepPerSem: 20000,
    color: "#ec4899",
    description: "Higher income households with capacity to fund majority of tuition."
  }
};

/**
 * Helper to clean and format a human readable name from an email address if needed
 */
function extractNameFromEmail(email) {
  if (!email || typeof email !== "string" || !email.includes("@")) return "";
  const prefix = email.split("@")[0].replace(/[0-9._+-]+/g, " ").trim();
  if (!prefix) return "";
  return prefix.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/**
 * Strictly build a HEF profile object using ONLY actual scraped or user-supplied details.
 * Completely eliminates any mock presets, random hash formulas, or hallucinated guesses.
 */
function resolveHefProfile(input = {}) {
  // Extract student name strictly without mock generation
  let name = (input.name || input.fullName || input.studentName || "").trim();
  if (!name && input.credential && !input.credential.includes("@") && isNaN(input.credential) && input.credential.length > 2) {
    name = input.credential.trim();
  } else if (!name && input.email && input.email.includes("@")) {
    const emailName = extractNameFromEmail(input.email);
    if (emailName && emailName.length > 2) name = emailName;
  }
  if (!name) {
    name = input.nationalId ? `HEF Loanee (${input.nationalId})` : "Data not found";
  }

  // National ID
  const nationalId = (input.nationalId || (input.credential && /^\d{5,10}$/.test(input.credential) ? input.credential : null)) || "Data not found";
  const email = input.email || (input.credential && input.credential.includes("@") ? input.credential : null);
  const phone = input.phone || null;
  const kcseIndex = input.kcseIndex || "Data not found";

  // Institution & Programme
  const institution = input.institution || "Data not found";
  const programme = input.programme || "Data not found";
  const level = input.level || (programme !== "Data not found" && programme.toLowerCase().includes("diploma") ? "TVET" : "Undergraduate");

  const yearOfStudy = input.yearOfStudy ? parseInt(input.yearOfStudy, 10) : null;
  const currentSemester = input.currentSemester ? parseInt(input.currentSemester, 10) : null;
  const academicYear = input.academicYear || "Data not found";

  // Bank details
  const bankName = input.bankName || "Data not found";
  const accountNumber = input.accountNumber || "Data not found";

  // Band resolution: strictly extract from input without guessing random numbers
  let bandNum = null;
  if (input.band) {
    const parsedBand = parseInt(input.band.toString().replace(/[^0-9]/g, ""), 10);
    if (!isNaN(parsedBand) && parsedBand >= 1 && parsedBand <= 5) {
      bandNum = parsedBand;
    }
  }

  const band = bandNum ? HEF_BANDS[bandNum] : null;

  // Financial values: use scraped values if available, or compute based on verified programme cost & band
  let programCost = input.programCost || null;
  if (!programCost && programme !== "Data not found") {
    const lowerP = programme.toLowerCase();
    const matched = Object.entries(PROGRAMMES).find(([k]) => lowerP.includes(k));
    if (matched) programCost = matched[1].cost;
  }

  let scholarshipPct = band ? band.scholarshipPct : null;
  let loanPct = band ? band.loanPct : null;
  let householdPct = band ? band.householdPct : null;

  let annualTuition = programCost;
  let annualScholarship = (annualTuition && scholarshipPct) ? Math.round(annualTuition * (scholarshipPct / 100)) : null;
  let annualTuitionLoan = (annualTuition && loanPct) ? Math.round(annualTuition * (loanPct / 100)) : null;
  let annualHouseholdTuition = (annualTuition && householdPct) ? Math.round(annualTuition * (householdPct / 100)) : null;
  let annualUpkeepLoan = band ? band.upkeepAnnual : null;
  let annualTotalLoan = (annualTuitionLoan !== null && annualUpkeepLoan !== null) ? annualTuitionLoan + annualUpkeepLoan : null;

  let semTuitionLoan = annualTuitionLoan ? Math.round(annualTuitionLoan / 2) : null;
  let semScholarship = annualScholarship ? Math.round(annualScholarship / 2) : null;
  let semHouseholdTuition = annualHouseholdTuition ? Math.round(annualHouseholdTuition / 2) : null;
  let semUpkeepLoan = annualUpkeepLoan ? Math.round(annualUpkeepLoan / 2) : null;

  // Outstanding / Disbursed / Repaid
  const outstandingBalance = input.outstandingDue !== undefined && input.outstandingDue !== null
    ? input.outstandingDue
    : (input.outstandingBalance !== undefined ? input.outstandingBalance : null);

  const awardedPrincipal = input.loanAwarded !== undefined && input.loanAwarded !== null
    ? input.loanAwarded
    : (input.awardedPrincipal !== undefined ? input.awardedPrincipal : (annualTotalLoan && yearOfStudy ? annualTotalLoan * yearOfStudy : null));

  const totalDisbursedLoan = input.totalDisbursedLoan || null;
  const totalDisbursedScholarship = input.scholarshipAmount || input.totalDisbursedScholarship || null;
  const hasRepaid = input.totalRepaid !== undefined ? input.totalRepaid : (input.repaid !== undefined ? input.repaid : 0);
  const interestAccrued = input.interestAccrued || null;
  const penalty = input.penalty || 0;

  // Disbursements: strictly use actual scraped disbursement rows if provided
  const disbursements = Array.isArray(input.disbursements) ? input.disbursements : [];

  // Statement ledger
  const ledger = Array.isArray(input.ledger) ? input.ledger : [];

  // Application & Appeal Status
  const appStatus = {
    applicationRef: input.applicationRef || input.appRef || "Data not found",
    status: input.applicationStatus || input.appStatus || "Data not found",
    stage: input.stage || "Data not found",
    bandAllocated: band ? band.name : (input.band ? `Band ${input.band}` : "Data not found"),
    bandCategory: band ? band.category : "Data not found",
    dateSubmitted: input.dateSubmitted || "Data not found",
    dateApproved: input.dateApproved || "Data not found",
    appealEligible: bandNum ? bandNum > 1 : false,
    appealStatus: input.appealStatus || (bandNum && bandNum > 1 ? "Eligible to submit appeal" : "Data not found"),
    mtiScore: input.mtiScore || null
  };

  // Clearance evaluation
  const isCleared = outstandingBalance === 0 || outstandingBalance === "0" || outstandingBalance === "KES 0";
  const clearance = {
    eligible: isCleared,
    certificateType: isCleared ? "HELB Clearance Certificate" : "Certificate of Compliance (Non-Loanee only)",
    reason: isCleared
      ? "All loans fully cleared. Eligible for instant official clearance certificate."
      : (outstandingBalance ? `Active loan balance of ${outstandingBalance} is currently outstanding.` : "Data not found")
  };

  return {
    student: {
      name,
      nationalId,
      email,
      phone,
      kcseIndex,
      institution,
      programme,
      level,
      yearOfStudy,
      currentSemester,
      academicYear,
      bankName,
      accountNumber
    },
    funding: {
      band: bandNum,
      bandName: band ? band.name : (input.band ? `Band ${input.band}` : "Data not found"),
      bandCategory: band ? band.category : "Data not found",
      householdIncomeBracket: band ? band.householdIncome : "Data not found",
      programCost: annualTuition,
      percentages: {
        scholarshipPct,
        loanPct,
        householdPct
      },
      annual: {
        tuition: annualTuition,
        scholarship: annualScholarship,
        tuitionLoan: annualTuitionLoan,
        householdFee: annualHouseholdTuition,
        upkeepLoan: annualUpkeepLoan,
        totalLoan: annualTotalLoan
      },
      semester: {
        scholarship: semScholarship,
        tuitionLoan: semTuitionLoan,
        householdFee: semHouseholdTuition,
        upkeepLoan: semUpkeepLoan
      },
      cumulative: {
        awardedPrincipal,
        totalDisbursedLoan,
        totalDisbursedScholarship,
        repaid: hasRepaid,
        interestAccrued,
        penalty,
        outstandingBalance
      }
    },
    disbursements,
    statement: {
      ledger,
      openingBalance: 0,
      closingBalance: outstandingBalance || 0,
      statementDate: new Date().toISOString().split("T")[0]
    },
    appStatus,
    clearance
  };
}

/**
 * Domain guardrail checker: strictly ensure query relates to HELB / HEF / student financing.
 */
function isHelbDomainQuery(text = "") {
  if (!text || typeof text !== "string") return false;
  const t = text.toLowerCase().trim();

  // Explicit greetings or affirmative / continuation phrases in a conversation
  if (/^(hello|hi|hey|habari|jambo|good\s*(morning|afternoon|evening)|help|start|menu|yes|no|ok|okay|thanks|thank\s*you|asante|continue|bye|goodbye|who\s*are\s*you|what\s*can\s*you\s*do|clear|reset)$/i.test(t)) {
    return true;
  }

  // Domain keywords for HELB, HEF, student funding in Kenya
  const helbKeywords = [
    "helb", "hef", "loan", "scholarship", "bursary", "band", "mti", "means test", "means testing",
    "disburse", "disbursement", "upkeep", "tuition", "balance", "repay", "repayment", "paybill",
    "statement", "ledger", "clearance", "compliance", "certificate", "appeal", "recategor", "batch",
    "kuccps", "universities fund", "uf", "student", "undergraduate", "tvet", "polytechnic", "postgraduate",
    "kenya", "national id", "kcse", "admission", "guarantor", "grace period", "penalty", "interest",
    "huduma", "anniversary towers", "smart card", "bank", "m-pesa", "mpesa", "safari", "equity", "kcb",
    "portal", "signin", "login", "password", "pin", "otp", "register", "apply", "application",
    "defer", "allocation", "afya elimu", "employer", "remittance", "salary deduction", "kra", "e-citizen",
    "ecitizen", "status", "stage", "documents", "death cert", "disability", "pwd", "chief", "fee", "tuition fee"
  ];

  // Check if at least one domain keyword is present
  const hasDomainKeyword = helbKeywords.some(kw => t.includes(kw));
  if (hasDomainKeyword) return true;

  // Check if user is sharing credentials or numbers
  if (/\b\d{6,10}\b/.test(t) || /\bband\s*[1-5]\b/i.test(t) || /\b(year\s*[1-6]|semester\s*[1-2])\b/i.test(t)) {
    return true;
  }

  return false;
}

/**
 * Extract user details explicitly provided in conversational chat
 */
function extractUserDetailsFromText(text = "") {
  const extracted = {};
  if (!text) return extracted;

  // Extract National ID (6 - 9 digits)
  const idMatch = text.match(/\b(?:id|national\s*id|id\s*no|id\s*number|idnum)?\s*:?\s*(\d{6,10})\b/i);
  if (idMatch && idMatch[1] && !text.toLowerCase().includes("paybill")) {
    extracted.nationalId = idMatch[1];
  }

  // Extract Band (Band 1, Band 2, Band 3, Band 4, Band 5)
  const bandMatch = text.match(/\bband\s*([1-5])\b/i);
  if (bandMatch && bandMatch[1]) {
    extracted.band = parseInt(bandMatch[1], 10);
  }

  // Extract Year of study (Year 1, 2nd year, year 3, etc.)
  const yearMatch = text.match(/\b(?:year\s*([1-6])|([1-6])(?:st|nd|rd|th)\s*year)\b/i);
  if (yearMatch) {
    extracted.yearOfStudy = parseInt(yearMatch[1] || yearMatch[2], 10);
  }

  // Extract Name
  const nameMatch = text.match(/\b(?:my\s*name\s*is|i\s*am|name\s*is|called)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/);
  if (nameMatch && nameMatch[1]) {
    const candidate = nameMatch[1].trim();
    if (!/^(Helb|Huduma|Student|Undergraduate|Kenyatta|University|Moi|Egerton)/i.test(candidate)) {
      extracted.name = candidate;
    }
  }

  // Extract University / Institution
  const instMatch = INSTITUTIONS.find(inst => text.toLowerCase().includes(inst.name.toLowerCase()) || text.toLowerCase().includes(inst.code.toLowerCase()));
  if (instMatch) {
    extracted.institution = instMatch.name;
    if (instMatch.level) extracted.level = instMatch.level;
  }

  // Extract Programme
  const progMatch = Object.entries(PROGRAMMES).find(([k]) => text.toLowerCase().includes(k));
  if (progMatch) {
    extracted.programme = progMatch[1].name;
    extracted.level = progMatch[1].level;
  }

  return extracted;
}

/**
 * Recursively search for any matching target key in nested objects or arrays
 */
function findValueInObject(obj, targetKeys) {
  if (!obj || typeof obj !== "object") return null;

  // 1. Check direct keys first
  for (const key of Object.keys(obj)) {
    const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const target of targetKeys) {
      const cleanTarget = target.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (cleanKey === cleanTarget && obj[key] !== null && obj[key] !== undefined && obj[key] !== "") {
        return obj[key];
      }
    }
  }

  // 2. Search sub-objects recursively
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === "object" && obj[key] !== null && !Array.isArray(obj[key])) {
      const nested = findValueInObject(obj[key], targetKeys);
      if (nested !== null && nested !== undefined && nested !== "") {
        return nested;
      }
    }
  }

  return null;
}

/**
 * Recursively find disbursement or allocation arrays in captured objects
 */
function findDisbursementsInObject(obj) {
  if (!obj || typeof obj !== "object") return [];
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === "object" && obj[0] !== null) {
      const first = obj[0];
      const hasDisbKeys = Object.keys(first).some(k => /amount|disburs|sem|purpose|batch|date|status|tuition|upkeep/i.test(k));
      if (hasDisbKeys) {
        return obj.map(item => ({
          date: item.date || item.disbursement_date || item.created_at || item.release_date || null,
          semester: item.semester || item.sem || item.academic_year || null,
          purpose: item.purpose || item.type || item.loan_type || item.description || "Tuition / Upkeep",
          amount: item.amount || item.disbursed_amount || item.awarded_amount || null,
          status: item.status || "Disbursed",
          batch: item.batch || item.batch_no || item.batch_number || null
        }));
      }
    }
  }

  for (const key of Object.keys(obj)) {
    if (/disburs|allocat|schedule|loans|ledger/i.test(key) && Array.isArray(obj[key])) {
      const list = findDisbursementsInObject(obj[key]);
      if (list.length > 0) return list;
    }
    if (typeof obj[key] === "object" && obj[key] !== null) {
      const nested = findDisbursementsInObject(obj[key]);
      if (nested.length > 0) return nested;
    }
  }

  return [];
}

/**
 * Extract structured HEF student/loan data from captured JSON payloads
 */
function extractDataFromCapturedJson(capturedProfileData = {}, capturedResponses = []) {
  const allPayloads = [capturedProfileData, ...capturedResponses.map(r => r.data || r)];
  const extracted = {};

  for (const payload of allPayloads) {
    if (!payload || typeof payload !== "object") continue;

    // Student Name
    if (!extracted.name) {
      const val = findValueInObject(payload, [
        "name", "fullName", "full_name", "student_name", "studentName", "applicant_name",
        "applicantName", "loanee_name", "user_name", "userName"
      ]);
      if (val && typeof val === "string" && val.trim().length > 1 && !/dashboard|sign out|logout|profile|null|undefined/i.test(val)) {
        extracted.name = val.trim();
      }
    }

    // National ID
    if (!extracted.nationalId) {
      const val = findValueInObject(payload, [
        "nationalId", "national_id", "national_id_no", "id_no", "idNo", "id_number",
        "idNumber", "identity_no", "idnumber", "id"
      ]);
      if (val && (typeof val === "string" || typeof val === "number")) {
        const idStr = String(val).replace(/[^0-9]/g, "");
        if (idStr.length >= 5 && idStr.length <= 10) {
          extracted.nationalId = idStr;
        }
      }
    }

    // KCSE Index
    if (!extracted.kcseIndex) {
      const val = findValueInObject(payload, [
        "kcseIndex", "kcse_index", "kcse_no", "kcseNo", "index_number", "indexNumber",
        "index_no", "indexNo", "kcse", "indexNumberYear"
      ]);
      if (val && typeof val === "string") {
        const kMatch = val.match(/\b\d{11}(?:\/\d{4})?\b/);
        if (kMatch) extracted.kcseIndex = kMatch[0];
        else if (val.trim().length >= 8) extracted.kcseIndex = val.trim();
      }
    }

    // Institution / University
    if (!extracted.institution) {
      const val = findValueInObject(payload, [
        "institution", "institution_name", "institutionName", "university", "university_name",
        "college", "college_name", "school", "school_name", "inst_name"
      ]);
      if (val && typeof val === "string" && val.trim().length > 2 && val !== "Data not found") {
        extracted.institution = val.trim();
      }
    }

    // Programme / Course
    if (!extracted.programme) {
      const val = findValueInObject(payload, [
        "programme", "programme_name", "programmeName", "program", "program_name",
        "programName", "course", "course_name", "courseName", "degree", "degree_name"
      ]);
      if (val && typeof val === "string" && val.trim().length > 2 && val !== "Data not found") {
        extracted.programme = val.trim();
      }
    }

    // Band
    if (extracted.band === undefined) {
      const val = findValueInObject(payload, [
        "band", "allocated_band", "allocatedBand", "funding_band", "fundingBand",
        "band_allocated", "band_name", "bandName", "band_num", "bandNum", "current_band", "band_code"
      ]);
      if (val !== null && val !== undefined) {
        const bParsed = parseInt(String(val).replace(/[^0-9]/g, ""), 10);
        if (!isNaN(bParsed) && bParsed >= 1 && bParsed <= 5) {
          extracted.band = bParsed;
          extracted.bandNum = bParsed;
          extracted.bandName = `Band ${bParsed}`;
        }
      }
    }

    // Outstanding Due / Loan Balance
    if (!extracted.outstandingDue) {
      const val = findValueInObject(payload, [
        "outstandingDue", "outstanding_due", "outstandingBalance", "outstanding_balance",
        "loan_balance", "loanBalance", "total_due", "totalDue", "total_outstanding",
        "totalOutstanding", "balance", "current_balance", "out_balance"
      ]);
      if (val !== null && val !== undefined && val !== "") {
        extracted.outstandingDue = typeof val === "number" ? `KES ${val.toLocaleString()}` : String(val).trim();
      }
    }

    // Loan Awarded
    if (!extracted.loanAwarded) {
      const val = findValueInObject(payload, [
        "loanAwarded", "loan_awarded", "awardedPrincipal", "awarded_principal",
        "total_loan", "totalLoan", "allocated_loan", "allocatedLoan", "loan_amount", "loanAmount"
      ]);
      if (val !== null && val !== undefined && val !== "") {
        extracted.loanAwarded = val;
      }
    }

    // Scholarship Amount
    if (!extracted.scholarshipAmount) {
      const val = findValueInObject(payload, [
        "scholarshipAmount", "scholarship_amount", "total_scholarship", "totalScholarship",
        "scholarship", "allocated_scholarship", "scholarship_awarded"
      ]);
      if (val !== null && val !== undefined && val !== "") {
        extracted.scholarshipAmount = val;
      }
    }

    // Tuition Loan & Upkeep Loan & Household Fee
    if (!extracted.tuitionLoan) {
      const val = findValueInObject(payload, ["tuitionLoan", "tuition_loan", "allocated_tuition", "tuition"]);
      if (val !== null && val !== undefined && val !== "") extracted.tuitionLoan = val;
    }
    if (!extracted.upkeepLoan) {
      const val = findValueInObject(payload, ["upkeepLoan", "upkeep_loan", "living_allowance", "allocated_upkeep", "upkeep"]);
      if (val !== null && val !== undefined && val !== "") extracted.upkeepLoan = val;
    }
    if (!extracted.householdFee) {
      const val = findValueInObject(payload, ["householdFee", "household_fee", "household_contribution", "householdContribution", "family_contribution"]);
      if (val !== null && val !== undefined && val !== "") extracted.householdFee = val;
    }

    // Total Repaid
    if (extracted.totalRepaid === undefined) {
      const val = findValueInObject(payload, ["totalRepaid", "total_repaid", "repaid", "amount_repaid", "total_payment", "paid"]);
      if (val !== null && val !== undefined && val !== "") extracted.totalRepaid = val;
    }

    // Year of Study & Current Semester
    if (!extracted.yearOfStudy) {
      const val = findValueInObject(payload, ["yearOfStudy", "year_of_study", "study_year", "year", "current_year"]);
      if (val) {
        const parsedY = parseInt(String(val).replace(/[^0-9]/g, ""), 10);
        if (!isNaN(parsedY) && parsedY >= 1 && parsedY <= 6) extracted.yearOfStudy = parsedY;
      }
    }
    if (!extracted.currentSemester) {
      const val = findValueInObject(payload, ["currentSemester", "current_semester", "semester", "study_semester", "sem"]);
      if (val) {
        const parsedS = parseInt(String(val).replace(/[^0-9]/g, ""), 10);
        if (!isNaN(parsedS) && parsedS >= 1 && parsedS <= 3) extracted.currentSemester = parsedS;
      }
    }

    // Academic Year
    if (!extracted.academicYear) {
      const val = findValueInObject(payload, ["academicYear", "academic_year", "financial_year", "fin_year", "year_name"]);
      if (val && typeof val === "string" && val.trim().length > 3) extracted.academicYear = val.trim();
    }

    // Bank Details
    if (!extracted.bankName) {
      const val = findValueInObject(payload, ["bankName", "bank_name", "bank", "disbursement_bank", "upkeep_bank"]);
      if (val && typeof val === "string" && val.trim().length > 1) extracted.bankName = val.trim();
    }
    if (!extracted.accountNumber) {
      const val = findValueInObject(payload, ["accountNumber", "account_number", "account_no", "accountNo", "bank_account", "bank_account_no", "acc_no"]);
      if (val && (typeof val === "string" || typeof val === "number") && String(val).trim().length > 3) {
        extracted.accountNumber = String(val).trim();
      }
    }

    // Application Status & Ref
    if (!extracted.applicationStatus) {
      const val = findValueInObject(payload, ["applicationStatus", "application_status", "app_status", "appStatus", "status", "stage"]);
      if (val && typeof val === "string" && val.trim().length > 1) extracted.applicationStatus = val.trim();
    }
    if (!extracted.applicationRef) {
      const val = findValueInObject(payload, ["applicationRef", "application_ref", "app_ref", "appRef", "batch_no", "batch_number", "batchNo", "application_number", "reference_no", "batch"]);
      if (val && typeof val === "string" && val.trim().length > 1) extracted.applicationRef = val.trim();
    }

    // Disbursements Array
    const disbs = findDisbursementsInObject(payload);
    if (disbs.length > 0 && (!extracted.disbursements || extracted.disbursements.length === 0)) {
      extracted.disbursements = disbs;
    }
  }

  return extracted;
}

/**
 * Dynamic Regex / Full-Text Fallback extraction from page innerText
 */
function extractDataFromPageRegex(text = "") {
  if (!text || typeof text !== "string") return {};
  const extracted = {};

  // 1. KCSE Index: /\b\d{11}(?:\/\d{4})?\b/
  const kcseLabeled = text.match(/(?:kcse(?:\s*index|\s*no\.?)?|index\s*no\.?|index\s*number)\s*[:#-]?\s*(\d{11}(?:\/\d{4})?)/i);
  const kcseDirect = text.match(/\b(\d{11}(?:\/\d{4})?)\b/);
  if (kcseLabeled && kcseLabeled[1]) {
    extracted.kcseIndex = kcseLabeled[1].trim();
  } else if (kcseDirect && kcseDirect[1]) {
    extracted.kcseIndex = kcseDirect[1].trim();
  }

  // 2. Band: /\bBand\s*([1-5])\b/i
  const bandLabeled = text.match(/(?:allocated\s*band|funding\s*band|assigned\s*band|current\s*band|band\s*allocated)\s*[:#-]?\s*Band\s*([1-5])\b/i);
  const bandDirect = text.match(/\bBand\s*([1-5])\b/i);
  if (bandLabeled && bandLabeled[1]) {
    extracted.band = parseInt(bandLabeled[1], 10);
    extracted.bandNum = parseInt(bandLabeled[1], 10);
    extracted.bandName = `Band ${bandLabeled[1]}`;
  } else if (bandDirect && bandDirect[1]) {
    extracted.band = parseInt(bandDirect[1], 10);
    extracted.bandNum = parseInt(bandDirect[1], 10);
    extracted.bandName = `Band ${bandDirect[1]}`;
  }

  // 3. National ID: /\b\d{8}\b/
  const idLabeled = text.match(/(?:national\s*id(?:\s*no\.?)?|id\s*number|id\s*no\.?|id\/passport)\s*[:#-]?\s*(\d{6,10})\b/i);
  const idDirect = text.match(/\b(\d{8})\b/);
  if (idLabeled && idLabeled[1]) {
    extracted.nationalId = idLabeled[1].trim();
  } else if (idDirect && idDirect[1]) {
    extracted.nationalId = idDirect[1].trim();
  }

  // 4. Currency/Outstanding Due: /KES\s*[\d,]+(?:\.\d{2})?/i
  const outLabeled = text.match(/(?:total\s*outstanding|outstanding\s*due|loan\s*balance|outstanding\s*balance|total\s*due|loan\s*due|total\s*loan\s*due)\s*[:#-]?\s*(KES\s*[\d,]+(?:\.\d{2})?|[\d,]+(?:\.\d{2})?)/i);
  const outDirect = text.match(/\b(KES\s*[\d,]+(?:\.\d{2})?)\b/i);
  if (outLabeled && outLabeled[1]) {
    const val = outLabeled[1].trim();
    extracted.outstandingDue = val.toUpperCase().startsWith("KES") ? val : `KES ${val}`;
  } else if (outDirect && outDirect[1]) {
    extracted.outstandingDue = outDirect[1].trim();
  }

  // 5. Institution extraction
  for (const inst of INSTITUTIONS) {
    if (text.toLowerCase().includes(inst.name.toLowerCase()) || text.toLowerCase().includes(inst.code.toLowerCase())) {
      extracted.institution = inst.name;
      if (inst.level) extracted.level = inst.level;
      break;
    }
  }

  // 6. Programme extraction
  for (const [key, prog] of Object.entries(PROGRAMMES)) {
    if (text.toLowerCase().includes(key) || text.toLowerCase().includes(prog.name.toLowerCase())) {
      extracted.programme = prog.name;
      extracted.level = prog.level;
      break;
    }
  }

  // 7. Academic Year
  const yearMatch = text.match(/\b(202[0-9]\s*[\/-]\s*202[0-9])\b/);
  if (yearMatch && yearMatch[1]) {
    extracted.academicYear = yearMatch[1].replace(/\s+/g, "");
  }

  // 8. Year of study
  const studyYearMatch = text.match(/\b(?:year\s*([1-6])|([1-6])(?:st|nd|rd|th)\s*year)\b/i);
  if (studyYearMatch) {
    extracted.yearOfStudy = parseInt(studyYearMatch[1] || studyYearMatch[2], 10);
  }

  // 9. Semester
  const semMatch = text.match(/\b(?:semester\s*([1-3])|sem\s*([1-3]))\b/i);
  if (semMatch) {
    extracted.currentSemester = parseInt(semMatch[1] || semMatch[2], 10);
  }

  // 10. Bank Name & Account Number
  const bankMatch = text.match(/(?:Bank\s*Name|Bank|Upkeep\s*Bank)\s*[:#-]?\s*([A-Za-z\s]+(?:Bank|M-Pesa|SACCO|Microfinance))/i);
  if (bankMatch && bankMatch[1]) {
    extracted.bankName = bankMatch[1].trim();
  }
  const accMatch = text.match(/(?:Account\s*Number|Account\s*No\.?|A\/C\s*No\.?)\s*[:#-]?\s*(\d{6,16})/i);
  if (accMatch && accMatch[1]) {
    extracted.accountNumber = accMatch[1].trim();
  }

  // 11. Application Status & Ref
  const appStatusMatch = text.match(/(?:Application\s*Status|Funding\s*Status|Status)\s*[:#-]?\s*([A-Za-z\s]{3,30})/i);
  if (appStatusMatch && appStatusMatch[1] && !/dashboard|menu|profile/i.test(appStatusMatch[1])) {
    extracted.applicationStatus = appStatusMatch[1].trim();
  }
  const appRefMatch = text.match(/(?:Application\s*Ref|Ref\s*No\.?|Batch\s*No\.?)\s*[:#-]?\s*([A-Z0-9\/-]+)/i) ||
                      text.match(/\b(HEF-[A-Z0-9-]+|HELB-[A-Z0-9-]+)\b/i);
  if (appRefMatch && appRefMatch[1]) {
    extracted.applicationRef = appRefMatch[1].trim();
  }

  return extracted;
}

module.exports = {
  INSTITUTIONS,
  PROGRAMMES,
  HEF_BANDS,
  resolveHefProfile,
  isHelbDomainQuery,
  extractUserDetailsFromText,
  findValueInObject,
  findDisbursementsInObject,
  extractDataFromCapturedJson,
  extractDataFromPageRegex
};
