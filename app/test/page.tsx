"use client"

export default function TestPage() {
  const testApi = async () => {
    const res = await fetch("/api/solve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: "e4e76ff8-66df-4409-b9c1-13af557817e0",
        questionId: "986dec00-21b1-42b5-9d04-40e5db33945a",
        selectedOption: "4",
      }),
    })

    const data = await res.json()
    console.log(data)
    alert(JSON.stringify(data))
  }

  return (
    <div className="p-10">
      <button
        onClick={testApi}
        className="bg-green-500 text-white px-6 py-3 rounded"
      >
        Test Solve API
      </button>
    </div>
  )
}