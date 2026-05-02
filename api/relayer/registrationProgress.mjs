const MAX_PROGRESS_STAGES = 32;
const registrationProgress = new Map();

export function recordRegistrationProgress(proofId, stage, label, details = {}) {
  if (typeof proofId !== "string" || proofId.length === 0) {
    return;
  }

  const current = registrationProgress.get(proofId) ?? {
    proofId,
    stages: [],
    updatedAt: null,
  };
  const nextStage = {
    at: new Date().toISOString(),
    details: sanitizeDetails(details),
    label,
    stage,
  };
  const stages = [...current.stages, nextStage].slice(-MAX_PROGRESS_STAGES);
  registrationProgress.set(proofId, {
    proofId,
    stages,
    updatedAt: nextStage.at,
  });
}

export function loadRegistrationProgress(proofId) {
  if (typeof proofId !== "string" || proofId.length === 0) {
    return {
      proofId: "",
      stages: [],
      updatedAt: null,
    };
  }

  return (
    registrationProgress.get(proofId) ?? {
      proofId,
      stages: [],
      updatedAt: null,
    }
  );
}

function sanitizeDetails(details) {
  const sanitized = {};
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return sanitized;
  }

  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string") {
      sanitized[key] = shortValue(value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function shortValue(value) {
  if (value.length <= 24) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}
