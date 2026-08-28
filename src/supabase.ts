import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

// Publishable keys are intentionally safe to include in browser/mobile clients.
// Supabase Row Level Security remains the actual protection for user data.
const defaultUrl = 'https://btrulgwueawocwwsqwqv.supabase.co';
const defaultPublishableKey = 'sb_publishable_2AVrbVALYo2h6r3JMycWnA_tA5LEDg9';
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? defaultUrl;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? defaultPublishableKey;

export const isBackendConfigured = true;

export const supabase = createClient(
  url,
  anonKey,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
