import Groq from 'groq-sdk'
import { executeFunction } from './supabaseTools.js'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })


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

const tools = [
  {
    type: 'function',
    function: {
      name: 'buscar_ciudades',
      description:
        'Busca ciudades disponibles en el sistema de buses. Úsala cuando el usuario quiera saber qué ciudades están disponibles, o necesites validar si una ciudad existe.',
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
  },
  {
    type: 'function',
    function: {
      name: 'buscar_rutas',
      description:
        'Busca rutas de bus disponibles entre ciudades. Retorna origen, destino, duración y precio estimado.',
      parameters: {
        type: 'object',
        properties: {
          ciudad_origen: {
            type: 'string',
            description: 'Nombre de la ciudad de origen (ej: "Bogotá")',
          },
          ciudad_destino: {
            type: 'string',
            description: 'Nombre de la ciudad de destino (ej: "Cali")',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_viajes',
      description:
        'Busca viajes de bus disponibles con horarios, precios y asientos. Requiere ciudad de origen y destino.',
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
  },
]

export async function handleChat(userMessage, history = []) {
  const messages = [
    { role: 'system', content: getSystemPrompt() },
    ...history
      .filter((msg) => msg.content && msg.content.trim())
      .map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      })),
    { role: 'user', content: userMessage },
  ]

  let iterations = 0
  const MAX_ITERATIONS = 5

  while (iterations < MAX_ITERATIONS) {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile', 
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 1024,
    })

    const message = response.choices[0].message
    const finishReason = response.choices[0].finish_reason

    messages.push(message)

    if (finishReason !== 'tool_calls' || !message.tool_calls?.length) {
      return message.content || 'Lo siento, no pude generar una respuesta. ¿Podrías reformular tu pregunta? 🤔'
    }

    for (const toolCall of message.tool_calls) {
      const { name, arguments: argsStr } = toolCall.function
      const args = JSON.parse(argsStr)

      console.log(` Groq llama función: ${name}(${JSON.stringify(args)})`)
      const result = await executeFunction(name, args)
      console.log(`  Resultado: ${JSON.stringify(result).slice(0, 200)}`)

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      })
    }

    iterations++
  }

  return 'Lo siento, no pude procesar tu solicitud. ¿Podrías intentarlo de nuevo? 🤔'
}