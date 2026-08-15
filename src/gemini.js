import { GoogleGenerativeAI } from '@google/generative-ai'
import { executeFunction } from './supabaseTools.js'

// ── Gemini Client ──────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

// ── System Prompt ──────────────────────────────────
function getSystemPrompt() {
  const hoy = new Date()
  const fechaHoy = hoy.toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return `Eres el asistente virtual de BusGo, una plataforma de buses interurbanos en Colombia.
Tu nombre es "Asistente BusGo".

REGLAS IMPORTANTES:
- Responde SIEMPRE en español colombiano, de forma amable y natural
- Usa emojis moderadamente para hacer la conversación amigable (🚌 📍 💰 🕐 ✅)
- Cuando el usuario pregunte por rutas, viajes, ciudades o precios, USA las funciones disponibles para consultar datos REALES. NUNCA inventes datos.
- Formatea los precios en pesos colombianos con separador de miles (ej: $85.000)
- Para fechas, usa formato legible (ej: "viernes 18 de julio")
- La fecha de HOY es: ${fechaHoy} (${hoy.toISOString().split('T')[0]})
- Si el usuario dice "hoy", la fecha es ${hoy.toISOString().split('T')[0]}
- Si el usuario dice "mañana", calcula la fecha sumando 1 día
- Si el usuario dice "pasado mañana", suma 2 días
- Si el usuario menciona un día de la semana (ej: "el viernes"), calcula la próxima fecha de ese día
- Cuando muestres viajes, organízalos de forma clara con hora, precio y asientos disponibles
- Si no hay viajes disponibles, sugiere otras fechas o rutas alternativas
- Sé conciso pero informativo. No escribas párrafos innecesariamente largos.
- Puedes responder preguntas generales sobre viajes en bus en Colombia (equipaje, terminales, etc.)
- Si te preguntan algo que NO está relacionado con viajes en bus, responde amablemente que solo puedes ayudar con temas de viajes en bus.

FORMATO DE RESPUESTA:
- Usa saltos de línea para separar secciones
- Para listar viajes usa este formato por cada viaje:
  🚌 [hora] — $[precio] · [asientos] asientos disponibles
- Siempre termina invitando al usuario a preguntar más o a tomar acción`
}

// ── Function Declarations (Tools) ──────────────────
const functionDeclarations = [
  {
    name: 'buscar_ciudades',
    description:
      'Busca ciudades disponibles en el sistema de buses. Úsala cuando el usuario quiera saber qué ciudades están disponibles, o necesites validar si una ciudad existe. Retorna nombre y departamento.',
    parameters: {
      type: 'object',
      properties: {
        filtro: {
          type: 'string',
          description:
            'Texto parcial para filtrar ciudades por nombre. Ejemplo: "bog" encontrará "Bogotá". Déjalo vacío para listar todas.',
        },
      },
    },
  },
  {
    name: 'buscar_rutas',
    description:
      'Busca rutas de bus disponibles entre ciudades. Retorna origen, destino, duración y precio estimado. Puede filtrar por ciudad de origen y/o destino.',
    parameters: {
      type: 'object',
      properties: {
        ciudad_origen: {
          type: 'string',
          description: 'Nombre de la ciudad de origen (ej: "Bogotá", "Medellín")',
        },
        ciudad_destino: {
          type: 'string',
          description: 'Nombre de la ciudad de destino (ej: "Cali", "Cartagena")',
        },
      },
    },
  },
  {
    name: 'buscar_viajes',
    description:
      'Busca viajes de bus disponibles con horarios, precios y asientos. Requiere al menos la ciudad de origen y destino. Opcionalmente puede filtrar por fecha.',
    parameters: {
      type: 'object',
      properties: {
        ciudad_origen: {
          type: 'string',
          description: 'Nombre de la ciudad de origen (requerido)',
        },
        ciudad_destino: {
          type: 'string',
          description: 'Nombre de la ciudad de destino (requerido)',
        },
        fecha: {
          type: 'string',
          description:
            'Fecha del viaje en formato YYYY-MM-DD. Si no se proporciona, busca los próximos viajes disponibles.',
        },
      },
      required: ['ciudad_origen', 'ciudad_destino'],
    },
  },
]

// ── Main Chat Handler ──────────────────────────────
export async function handleChat(userMessage, history = []) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: getSystemPrompt(),
    tools: [{ functionDeclarations }],
  })

  // Build Gemini-compatible history from the frontend format
  const chatHistory = history
    .filter((msg) => msg.content && msg.content.trim())
    .map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }))

  const chat = model.startChat({ history: chatHistory })

  // Send user message to Gemini
  let result = await chat.sendMessage(userMessage)
  let response = result.response

  // ── Function Calling Loop ──────────────────────
  // Gemini may request to call functions. We execute them and feed results back.
  let iterations = 0
  const MAX_ITERATIONS = 5

  while (iterations < MAX_ITERATIONS) {
    const candidate = response.candidates?.[0]
    const parts = candidate?.content?.parts || []

    // Check if Gemini wants to call a function
    const functionCallPart = parts.find((p) => p.functionCall)
    if (!functionCallPart) break // No function call → we have the final text

    const { name, args } = functionCallPart.functionCall
    console.log(` Gemini llama función: ${name}(${JSON.stringify(args)})`)

    // Execute the function against Supabase
    const functionResult = await executeFunction(name, args)
    console.log(
      `  Resultado: ${JSON.stringify(functionResult).slice(0, 200)}${
        JSON.stringify(functionResult).length > 200 ? '...' : ''
      }`
    )

    // Send function result back to Gemini
    result = await chat.sendMessage([
      {
        functionResponse: {
          name,
          response: { result: functionResult },
        },
      },
    ])
    response = result.response
    iterations++
  }

  // ── Extract final text response ────────────────
  const textParts =
    response.candidates?.[0]?.content?.parts?.filter((p) => p.text) || []
  const finalText = textParts.map((p) => p.text).join('\n')

  if (!finalText) {
    return 'Lo siento, no pude generar una respuesta. ¿Podrías reformular tu pregunta? 🤔'
  }

  return finalText
}
