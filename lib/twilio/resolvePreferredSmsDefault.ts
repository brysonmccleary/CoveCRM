function normalizePhone(input: string) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return String(input || "").startsWith("+") ? String(input || "") : `+${digits}`;
}

function getEntryId(entry: any) {
  return String(entry?._id || entry?.sid || "");
}

function isValidSmsNumber(entry: any) {
  const phoneNumber = normalizePhone(String(entry?.phoneNumber || ""));
  if (!phoneNumber) return false;
  if (String(entry?.status || "").toLowerCase() === "inactive") return false;
  if (entry?.capabilities && entry.capabilities.sms !== true) return false;
  return true;
}

function isTollFree(phoneNumber: string) {
  return /^\+1(800|888|877|866|855|844|833|822)/.test(
    normalizePhone(phoneNumber),
  );
}

function sortNewest(numbers: any[]) {
  return numbers
    .map((entry, index) => ({
      entry,
      index,
      timestamp: new Date((entry as any)?.purchasedAt || 0).getTime() || 0,
    }))
    .sort((a, b) => {
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      return b.index - a.index;
    })
    .map((item) => item.entry);
}

export async function resolvePreferredSmsDefault(
  user: any,
  opts?: { save?: boolean },
) {
  const shouldSave = opts?.save !== false;
  const currentDefaultId = String(user?.defaultSmsNumberId || "");
  const validNumbers = sortNewest(
    (Array.isArray(user?.numbers) ? user.numbers : []).filter(isValidSmsNumber),
  );
  const currentDefault =
    validNumbers.find((entry: any) => getEntryId(entry) === currentDefaultId) ||
    null;
  const validNonTollFree = validNumbers.filter(
    (entry: any) => !isTollFree(String(entry?.phoneNumber || "")),
  );

  let preferred = currentDefault;
  let reason:
    | "invalid_default"
    | "preferred_non_toll_free"
    | "single_valid_number"
    | null = null;

  if (!preferred) {
    if (validNumbers.length === 1) {
      preferred = validNumbers[0];
      reason = "single_valid_number";
    } else if (validNonTollFree.length > 0) {
      preferred = validNonTollFree[0];
      reason = "preferred_non_toll_free";
    } else if (validNumbers.length > 0) {
      preferred = validNumbers[0];
      reason = "invalid_default";
    }
  }

  const nextDefaultId = preferred ? getEntryId(preferred) : null;
  const changed = String(currentDefaultId || "") !== String(nextDefaultId || "");

  if (changed) {
    user.defaultSmsNumberId = nextDefaultId;
    if (reason) {
      console.info(
        JSON.stringify({
          msg: "resolvePreferredSmsDefault: auto-switched default",
          userEmail: user?.email || null,
          userId: user?._id ? String(user._id) : null,
          oldDefault: currentDefaultId || null,
          newDefault: nextDefaultId,
          reason,
        }),
      );
    }
    if (shouldSave && typeof user?.save === "function") {
      if (typeof user.markModified === "function") {
        user.markModified("defaultSmsNumberId");
      }
      await user.save();
    }
  }

  return {
    changed,
    reason,
    preferredNumber: preferred,
    defaultSmsNumberId: nextDefaultId,
  };
}
