import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { handleChat } from './groq.js'


const app = express()
const PORT = process.env.PORT || 3001

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3001',
  'http://localhost:4173',
  process.env.FRONTEND_URL
].filter(Boolean)

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'BusGo Chatbot API',
    timestamp: new Date().toISOString(),
  })
})

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'El campo "message" es requerido.' })
    }

    console.log(`\n Usuario: ${message}`)
    const response = await handleChat(message, history || [])
    console.log(`Bot: ${response.slice(0, 120)}...`)

    res.json({ response })
  } catch (error) {
    console.log(error)
    // console.error('Error en /api/chat:', error.message)
    res.status(500).json({
      error: 'Hubo un error al procesar tu mensaje. Intenta de nuevo.',
    })
  }
})

app.listen(PORT, () => {
  console.log(`\n BusGo Chatbot API corriendo en http://localhost:${PORT}`)
  console.log(` Health check: http://localhost:${PORT}/api/health`)
  console.log(` Chat endpoint: POST http://localhost:${PORT}/api/chat\n`)
})
