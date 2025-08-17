import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import toast from "react-hot-toast";

export default function AccountPanel() {
  const { data: session } = useSession();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [country, setCountry] = useState("United States");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (session?.user?.email) {
      axios
        .get(`/api/user-info?email=${session.user.email}`)
        .then((res) => {
          setFirstName(res.data.firstName);
          setLastName(res.data.lastName);
          setCountry(res.data.country || "United States");
          setEmail(res.data.email);
        })
        .catch(() => toast.error("Failed to load user data"));
    }
  }, [session?.user?.email]);

  const handleSaveProfile = async () => {
    try {
      await axios.put("/api/update-profile", {
        email,
        firstName,
        lastName,
        country,
      });
      toast.success("Profile updated successfully");
    } catch (err) {
      toast.error("Failed to update profile");
    }
  };

  const handleSaveEmail = async () => {
    if (!session?.user?.email) {
      toast.error("User session not found");
      return;
    }
    try {
      await axios.put("/api/update-email", {
        currentEmail: session.user.email,
        newEmail: email,
      });
      toast.success("Email updated successfully");
    } catch (err) {
      toast.error("Failed to update email");
    }
  };

  const handleSavePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (!session?.user?.email) {
      toast.error("User session not found");
      return;
    }
    try {
      await axios.put("/api/update-password", {
        email: session.user.email,
        newPassword,
      });
      toast.success("Password updated successfully");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error("Failed to update password");
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-bold">Account</h2>
        <p className="text-gray-600 mb-4">Profile</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label>First Name</label>
            <input className="input input-bordered w-full" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label>Last Name</label>
            <input className="input input-bordered w-full" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <label>Country</label>
            <select className="input input-bordered w-full" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option>United States</option>
              <option>Canada</option>
              <option>UK</option>
            </select>
          </div>
        </div>
        <button className="btn btn-primary mt-4" onClick={handleSaveProfile}>Save Profile</button>
      </section>

      <section>
        <h3 className="text-lg font-semibold">Email</h3>
        <input className="input input-bordered w-full" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn btn-secondary mt-2" onClick={handleSaveEmail}>Save Email</button>
      </section>

      <section>
        <h3 className="text-lg font-semibold">Change Password</h3>
        <input className="input input-bordered w-full mb-2" type="password" placeholder="New Password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <input className="input input-bordered w-full" type="password" placeholder="Confirm New Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        <button className="btn btn-secondary mt-2" onClick={handleSavePassword}>Save Password</button>
      </section>
    </div>
  );
}
