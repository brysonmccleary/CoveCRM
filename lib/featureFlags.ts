export function isAdmin(userEmail: string) {
  return (userEmail || "").toLowerCase() === "bryson.mccleary1@gmail.com";
}
