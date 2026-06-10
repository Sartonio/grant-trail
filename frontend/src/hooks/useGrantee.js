import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export function useUser() {
  const [userRecord, setUserRecord] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      setLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data, error } = await supabase
          .from("users")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (error) {
          console.error("Error fetching user record:", error);
        } else {
          setUserRecord(data);
        }
      }

      setLoading(false);
    };

    fetchUser();
  }, []);

  return { userRecord, loading };
}

// backwards-compat alias
export function useGrantee() {
  const { userRecord, loading } = useUser();
  return { grantee: userRecord, loading };
}