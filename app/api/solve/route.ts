import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

function calculateElo(playerRating: number, opponentRating: number, score: number) {
  const K = 32
  const expectedScore =
    1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400))
  return Math.round(playerRating + K * (score - expectedScore))
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userId, questionId, selectedOption } = body

    // 1️⃣ Get user
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single()

    if (userError || !user) {
      return NextResponse.json({ error: "User not found" }, { status: 400 })
    }

    // 2️⃣ Get question
    const { data: question, error: questionError } = await supabase
      .from("questions")
      .select("*")
      .eq("id", questionId)
      .single()

    if (questionError || !question) {
      return NextResponse.json({ error: "Question not found" }, { status: 400 })
    }

    const isCorrect = selectedOption === question.correct_option
    const score = isCorrect ? 1 : 0

    // 3️⃣ Calculate new ratings
    const newUserRating = calculateElo(user.rating, question.rating, score)
    const newQuestionRating = calculateElo(
      question.rating,
      user.rating,
      1 - score
    )

    // 4️⃣ Streak Logic
    const today = new Date().toISOString().split("T")[0]
    let newStreak = user.streak || 0

    if (!user.last_solved_date) {
      newStreak = 1
    } else {
      const lastDate = new Date(user.last_solved_date)
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)

      const last = lastDate.toISOString().split("T")[0]
      const yest = yesterday.toISOString().split("T")[0]

      if (last === today) {
        // same day → no change
      } else if (last === yest) {
        newStreak += 1
      } else {
        newStreak = 1
      }
    }

    // 5️⃣ Update user
    await supabase
      .from("users")
      .update({
        rating: newUserRating,
        streak: newStreak,
        last_solved_date: today,
      })
      .eq("id", userId)

    // 6️⃣ Update question rating
    await supabase
      .from("questions")
      .update({ rating: newQuestionRating })
      .eq("id", questionId)

    // 7️⃣ Save attempt
    await supabase.from("attempts").insert({
      user_id: userId,
      question_id: questionId,
      is_correct: isCorrect,
    })

    return NextResponse.json({
      correct: isCorrect,
      newUserRating,
      newStreak,
    })
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}