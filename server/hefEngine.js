/**
 * Huduma Smart — Higher Education Financing (HEF) & HELB Engine
 * Implements the exact Kenya HEF Student-Centered Funding Model (Bands 1 - 5 & TVET)
 * and realistic portal data generation for user details.
 */

// Preset Kenyan Universities & Institutions with realistic tuition costs
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

// Preset Programme Costs per academic year in KES
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
 * Deterministic hash from string for consistent realistic mock generation
 */
function hashString(str) {
  let hash = 0;
  if (!str || str.length === 0) return 12345;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

const PRESETS = {
  "38492018": {
    name: "Brian Kiprop Cheruiyot",
    nationalId: "38492018",
    email: "brian.cheruiyot@students.ku.ac.ke",
    phone: "+254 712 345 678",
    kcseIndex: "12345678001/2022",
    institution: "Kenyatta University (KU)",
    programme: "Bachelor of Science in Computer Science",
    level: "Undergraduate",
    yearOfStudy: 2,
    currentSemester: 1,
    band: 2,
    academicYear: "2024/2025",
    bankName: "Equity Bank Kenya",
    accountNumber: "0112938472901",
    repaid: 0,
    penalty: 0
  },
  "39102948": {
    name: "Faith Wanjiku Mwangi",
    nationalId: "39102948",
    email: "faith.wanjiku@students.uonbi.ac.ke",
    phone: "+254 722 987 654",
    kcseIndex: "11200001004/2021",
    institution: "University of Nairobi (UoN)",
    programme: "Bachelor of Medicine and Bachelor of Surgery (MBChB)",
    level: "Undergraduate",
    yearOfStudy: 3,
    currentSemester: 1,
    band: 1,
    academicYear: "2024/2025",
    bankName: "KCB Bank Kenya",
    accountNumber: "1289401928",
    repaid: 0,
    penalty: 0
  },
  "36829104": {
    name: "Kevin Otieno Omondi",
    nationalId: "36829104",
    email: "kevin.otieno@students.jkuat.ac.ke",
    phone: "+254 733 456 789",
    kcseIndex: "20400002019/2020",
    institution: "Jomo Kenyatta University of Agriculture and Technology (JKUAT)",
    programme: "Bachelor of Science in Electrical & Electronic Engineering",
    level: "Undergraduate",
    yearOfStudy: 4,
    currentSemester: 1,
    band: 3,
    academicYear: "2024/2025",
    bankName: "Co-operative Bank of Kenya",
    accountNumber: "01192847192",
    repaid: 15000,
    penalty: 0
  }
};

/**
 * Find or generate realistic user details based on inputs
 */
function resolveHefProfile(input = {}) {
  const cleanId = (input.nationalId || input.credential || input.email || "").trim();
  if (PRESETS[cleanId]) {
    input = { ...PRESETS[cleanId], ...input };
  }

  const seed = hashString(input.nationalId || input.email || input.credential || input.name || "38492018");
  
  // Resolve Band (default: 2 or user provided)
  let bandNum = parseInt(input.band, 10);
  if (isNaN(bandNum) || bandNum < 1 || bandNum > 5) {
    bandNum = (seed % 4) + 1; // 1 to 4
  }
  const band = HEF_BANDS[bandNum];

  // Resolve Names
  const defaultFirstNames = ["Brian", "Faith", "Kevin", "Mercy", "Dennis", "Amina", "Emmanuel", "Brenda", "Victor", "Sharon"];
  const defaultLastNames = ["Kiprop", "Mwangi", "Otieno", "Wanjiku", "Ochieng", "Hassan", "Mutua", "Chepkemoi", "Koech", "Kamau"];
  const defaultSurnames = ["Cheruiyot", "Kariuki", "Odhiambo", "Njeri", "Omondi", "Abdi", "Musyoka", "Rotich", "Kimani", "Maina"];

  const fn = defaultFirstNames[seed % defaultFirstNames.length];
  const ln = defaultLastNames[(seed + 3) % defaultLastNames.length];
  const sn = defaultSurnames[(seed + 7) % defaultSurnames.length];
  const defaultName = `${fn} ${ln} ${sn}`;

  const name = input.name || (input.credential && !input.credential.includes("@") && isNaN(input.credential) ? input.credential : defaultName);
  
  // National ID / KCSE Index
  const nationalId = input.nationalId || (input.credential && /^\d{5,10}$/.test(input.credential) ? input.credential : `${30000000 + (seed % 9999999)}`);
  const email = input.email || (input.credential && input.credential.includes("@") ? input.credential : `${name.toLowerCase().replace(/[^a-z]/g, ".")}${seed % 99}@students.ac.ke`);
  const kcseIndex = input.kcseIndex || `${10000000000 + (seed % 8999999999)}/${2021 + (seed % 3)}`;

  // Institution
  let institution = input.institution;
  if (!institution) {
    const inst = INSTITUTIONS[seed % (INSTITUTIONS.length - 4)]; // pick public university by default
    institution = inst.name;
  }

  // Study Level & Programme
  let level = input.level || "Undergraduate";
  let programme = input.programme;
  let programCost = input.programCost;

  if (!programme) {
    const progKeys = Object.keys(PROGRAMMES);
    const selectedKey = progKeys[seed % progKeys.length];
    const selectedProg = PROGRAMMES[selectedKey];
    programme = selectedProg.name;
    programCost = programCost || selectedProg.cost;
    level = selectedProg.level;
  } else {
    // try to match programme cost
    const lowerP = programme.toLowerCase();
    const matched = Object.entries(PROGRAMMES).find(([k]) => lowerP.includes(k));
    programCost = programCost || (matched ? matched[1].cost : 216000);
  }

  const yearOfStudy = Math.min(Math.max(parseInt(input.yearOfStudy, 10) || ((seed % 3) + 1), 1), 6);
  const currentSemester = parseInt(input.currentSemester, 10) === 2 ? 2 : 1;
  const academicYear = input.academicYear || "2024/2025";

  // Bank / Disbursement channel details
  const banks = ["Equity Bank Kenya", "KCB Bank Kenya", "Co-operative Bank of Kenya", "Postbank Kenya", "M-Pesa Safaricom"];
  const bankName = input.bankName || banks[seed % banks.length];
  const accountNumber = input.accountNumber || (bankName.includes("M-Pesa") ? `07${10000000 + (seed % 89999999)}` : `011${1000000000 + (seed % 899999999)}`);
  const phone = input.phone || `+254 7${10000000 + (seed % 89999999)}`;

  // ── Calculate HEF Financial Breakdown ──
  const annualTuition = programCost;
  const scholarshipPct = band.scholarshipPct;
  const loanPct = band.loanPct;
  const householdPct = band.householdPct;

  const annualScholarship = Math.round(annualTuition * (scholarshipPct / 100));
  const annualTuitionLoan = Math.round(annualTuition * (loanPct / 100));
  const annualHouseholdTuition = Math.round(annualTuition * (householdPct / 100));
  const annualUpkeepLoan = band.upkeepAnnual;

  const annualTotalLoan = annualTuitionLoan + annualUpkeepLoan;
  const semTuitionLoan = Math.round(annualTuitionLoan / 2);
  const semScholarship = Math.round(annualScholarship / 2);
  const semHouseholdTuition = Math.round(annualHouseholdTuition / 2);
  const semUpkeepLoan = Math.round(annualUpkeepLoan / 2);

  // Cumulative calculations based on year of study
  // e.g. Year 2 Semester 1 = 2 semesters completed, entering 3rd
  const completedSemesters = (yearOfStudy - 1) * 2 + (currentSemester - 1);

  const cumulativeAwardedPrincipal = Math.round(annualTotalLoan * yearOfStudy);
  const cumulativeDisbursedTuitionLoan = Math.round(semTuitionLoan * completedSemesters);
  const cumulativeDisbursedUpkeepLoan = Math.round(semUpkeepLoan * completedSemesters);
  const cumulativeDisbursedScholarship = Math.round(semScholarship * completedSemesters);
  const cumulativeDisbursedLoan = cumulativeDisbursedTuitionLoan + cumulativeDisbursedUpkeepLoan;

  // Repayments (for graduated or continuing students who made voluntary payments)
  const hasRepaid = input.repaid !== undefined ? parseInt(input.repaid, 10) : ((seed % 7 === 0) ? 15000 : (seed % 11 === 0) ? 35500 : 0);
  const interestRate = 0.04; // 4% p.a.
  const interestAccrued = Math.round(cumulativeDisbursedLoan * interestRate * Math.max(0.5, yearOfStudy - 1));
  const penalty = input.penalty !== undefined ? parseInt(input.penalty, 10) : 0;
  const currentOutstandingBalance = Math.max(0, cumulativeDisbursedLoan + interestAccrued + penalty - hasRepaid);

  // ── Build Realistic Disbursement Schedule ──
  const disbursements = [];
  const startCalYear = 2024 - (yearOfStudy - 1);

  for (let yr = 1; yr <= yearOfStudy; yr++) {
    const acadYr = `${startCalYear + yr - 1}/${startCalYear + yr}`;
    
    // Semester 1 (Disbursed in September/October)
    const sem1Date = `${startCalYear + yr - 1}-09-24`;
    const isSem1Done = yr < yearOfStudy || (yr === yearOfStudy && currentSemester >= 1);
    
    disbursements.push({
      academicYear: acadYr,
      semester: "Semester 1",
      date: sem1Date,
      purpose: "Upkeep Loan",
      amount: semUpkeepLoan,
      beneficiary: `${name} (${bankName} - ${accountNumber})`,
      batchNumber: `HEF/${acadYr}/UPK/B${bandNum}-${1000 + (seed % 8000) + yr * 10}`,
      status: isSem1Done ? "Disbursed" : "Scheduled",
      reference: `MP${hashString(acadYr + sem1Date + 'UPK').toString(36).toUpperCase()}`
    });

    disbursements.push({
      academicYear: acadYr,
      semester: "Semester 1",
      date: sem1Date,
      purpose: "Tuition Loan & Scholarship",
      amount: semTuitionLoan + semScholarship,
      breakdown: { tuitionLoan: semTuitionLoan, scholarship: semScholarship },
      beneficiary: `${institution} Fee Collection Account`,
      batchNumber: `HEF/${acadYr}/TUI/B${bandNum}-${2000 + (seed % 8000) + yr * 10}`,
      status: isSem1Done ? "Disbursed" : "Scheduled",
      reference: `TU${hashString(acadYr + sem1Date + 'TUI').toString(36).toUpperCase()}`
    });

    // Semester 2 (Disbursed in January/February)
    if (yr < yearOfStudy || (yr === yearOfStudy && currentSemester === 2)) {
      const sem2Date = `${startCalYear + yr}-02-14`;
      const isSem2Done = yr < yearOfStudy || (yr === yearOfStudy && currentSemester === 2);

      disbursements.push({
        academicYear: acadYr,
        semester: "Semester 2",
        date: sem2Date,
        purpose: "Upkeep Loan",
        amount: semUpkeepLoan,
        beneficiary: `${name} (${bankName} - ${accountNumber})`,
        batchNumber: `HEF/${acadYr}/UPK/B${bandNum}-${3000 + (seed % 8000) + yr * 10}`,
        status: isSem2Done ? "Disbursed" : "Scheduled",
        reference: `MP${hashString(acadYr + sem2Date + 'UPK').toString(36).toUpperCase()}`
      });

      disbursements.push({
        academicYear: acadYr,
        semester: "Semester 2",
        date: sem2Date,
        purpose: "Tuition Loan & Scholarship",
        amount: semTuitionLoan + semScholarship,
        breakdown: { tuitionLoan: semTuitionLoan, scholarship: semScholarship },
        beneficiary: `${institution} Fee Collection Account`,
        batchNumber: `HEF/${acadYr}/TUI/B${bandNum}-${4000 + (seed % 8000) + yr * 10}`,
        status: isSem2Done ? "Disbursed" : "Scheduled",
        reference: `TU${hashString(acadYr + sem2Date + 'TUI').toString(36).toUpperCase()}`
      });
    }
  }

  // ── Build Official HELB Ledger / Statement ──
  const ledger = [];
  let runningBal = 0;

  disbursements.filter(d => d.status === "Disbursed").forEach(d => {
    if (d.purpose === "Upkeep Loan") {
      runningBal += d.amount;
      ledger.push({
        date: d.date,
        reference: d.reference,
        description: `Disbursement: ${d.academicYear} ${d.semester} Upkeep Loan to ${bankName}`,
        debit: d.amount,
        credit: 0,
        balance: runningBal
      });
    } else if (d.purpose === "Tuition Loan & Scholarship") {
      runningBal += d.breakdown.tuitionLoan;
      ledger.push({
        date: d.date,
        reference: d.reference,
        description: `Disbursement: ${d.academicYear} ${d.semester} Tuition Loan to ${institution}`,
        debit: d.breakdown.tuitionLoan,
        credit: 0,
        balance: runningBal
      });
    }
  });

  if (hasRepaid > 0) {
    runningBal -= hasRepaid;
    ledger.push({
      date: "2024-08-10",
      reference: `MPE${hashString(nationalId + 'PAY').toString(36).toUpperCase()}`,
      description: "Repayment: M-Pesa Paybill 200800 Direct Settlement",
      debit: 0,
      credit: hasRepaid,
      balance: runningBal
    });
  }

  // Application & Appeal Status
  const appStatus = {
    applicationRef: `HEF-${academicYear.replace('/', '-')}-${nationalId.slice(-4)}`,
    status: "Approved",
    stage: "Funds Allocation & Disbursement Active",
    bandAllocated: band.name,
    bandCategory: band.category,
    dateSubmitted: `${startCalYear}-07-18`,
    dateEvaluated: `${startCalYear}-08-22`,
    dateApproved: `${startCalYear}-09-05`,
    appealEligible: bandNum > 1,
    appealStatus: input.appealStatus || (bandNum > 1 ? "Eligible to submit appeal" : "Not applicable (Max Band 1)"),
    mtiScore: 92 - (bandNum * 12) + (seed % 7) // Means Testing Instrument score
  };

  // Clearance Certificate
  const clearance = {
    eligible: currentOutstandingBalance === 0,
    certificateType: currentOutstandingBalance === 0 ? "HELB Clearance Certificate" : "Certificate of Compliance (Non-Loanee only)",
    reason: currentOutstandingBalance === 0 
      ? "All loans fully cleared. Eligible for instant official clearance certificate."
      : `Active loan balance of KES ${currentOutstandingBalance.toLocaleString()} is currently outstanding.`
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
      bandName: band.name,
      bandCategory: band.category,
      householdIncomeBracket: band.householdIncome,
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
        awardedPrincipal: cumulativeAwardedPrincipal,
        totalDisbursedLoan: cumulativeDisbursedLoan,
        totalDisbursedScholarship: cumulativeDisbursedScholarship,
        repaid: hasRepaid,
        interestAccrued,
        penalty,
        outstandingBalance: currentOutstandingBalance
      }
    },
    disbursements,
    statement: {
      ledger,
      openingBalance: 0,
      closingBalance: currentOutstandingBalance,
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

  // Check if user is sharing credentials or numbers (e.g. "My ID is 38291045", "Brian Mwangi", "Band 2", etc.)
  if (/\b\d{6,10}\b/.test(t) || /\bband\s*[1-5]\b/i.test(t) || /\b(year\s*[1-6]|semester\s*[1-2])\b/i.test(t)) {
    return true;
  }

  return false;
}

/**
 * Extract user details mentioned in conversational chat
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

  // Extract Name (e.g., "My name is John Doe", "I am Faith Wanjiku", "Name: Brian Kiprop")
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

module.exports = {
  INSTITUTIONS,
  PROGRAMMES,
  HEF_BANDS,
  resolveHefProfile,
  isHelbDomainQuery,
  extractUserDetailsFromText
};
