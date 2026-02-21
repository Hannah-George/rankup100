import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const subject = searchParams.get("subject")
  const exam = searchParams.get("exam")

  const { data, error } = await supabase
    .from("questions")
    .select("*")
    .eq("subject", subject)
    .eq("exam", exam)

  if (error || !data || data.length === 0) {
    return NextResponse.json({ error: "No questions found" }, { status: 400 })
  }

  const randomQuestion =
    data[Math.floor(Math.random() * data.length)]

  return NextResponse.json(randomQuestion)
}