import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/** Kollar profiles.is_admin för inloggad användare (tävlingsledning). */
export function useIsAdmin() {
  const { userId } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!userId) {
      setIsAdmin(false);
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        if (active) setIsAdmin(data?.is_admin ?? false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  return isAdmin;
}
