import 'dotenv/config'
import path from 'path'
import fs from 'fs-extra'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/cluster-adapter'
import eiows from 'eiows'
import compression from 'compression'
import axios from 'axios'
import cors from 'cors'
import { createClient } from 'redis'
import bodyParser from 'body-parser'
import helmet from 'helmet'
import v from 'voca'
import multer from 'multer'
import Busboy from 'busboy'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import archiver from 'archiver'
import extract from 'extract-zip'
import dayjs from 'dayjs'
import 'dayjs/locale/es.js'
import 'dayjs/locale/fr.js'
import 'dayjs/locale/it.js'
import 'dayjs/locale/de.js'
import localizedFormat from 'dayjs/plugin/localizedFormat.js'
import bcrypt from 'bcrypt'
import cron from 'node-cron'
import nodemailer from 'nodemailer'
import { fileURLToPath } from 'url'
import { RedisStore } from 'connect-redis'
import session from 'express-session'
import { randomBytes } from 'crypto'
import Rabbit from 'crypto-js/rabbit.js'
import Utf8 from 'crypto-js/enc-utf8.js'
import { NameForgeJS } from './nameforge.js'
import { Agent } from 'https'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { S3Client, CopyObjectCommand, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { renderPage, createDevMiddleware } from 'vike/server'
// Charger strings langues
import t from './lang.js'

const production = process.env.NODE_ENV === 'production'
let cluster = false
if (production) {
	cluster = parseInt(process.env.NODE_CLUSTER) === 1
}
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = `${__dirname}/..`

// Vérifier si un buffer est une image jpg ou png (pour PDFKit)
const magic = ['4a464946', '89504e47', 'ffd8ffe1']

demarrerServeur()

async function demarrerServeur () {
	const app = express()
	app.use(compression())
	const httpServer = createServer(app)

	let hote = 'http://localhost:3000'
	if (production) {
		hote = process.env.DOMAIN
	} else if (process.env.PORT) {
		hote = 'http://localhost:' + process.env.PORT
	}
	let stockage = 'fs'
	const lienPublicS3 = process.env.VITE_S3_PUBLIC_LINK
	let s3Client = ''
	let bucket = ''
	if (process.env.VITE_STORAGE && process.env.VITE_STORAGE === 's3' && lienPublicS3 !== null && lienPublicS3 !== '') {
		stockage = 's3'
		bucket = process.env.S3_BUCKET
	}
	if (stockage === 's3') {
		const s3ServerType = process.env.S3_SERVER_TYPE || 'aws'
		const maxSockets = process.env.S3_MAX_SOCKETS || 500
		const agent = new Agent({
			keepAlive: true,
			maxSockets: maxSockets
		})
		s3Client = new S3Client({
			endpoint: process.env.S3_ENDPOINT,
			region: process.env.S3_REGION,
			credentials: {
				accessKeyId: process.env.S3_ACCESS_KEY,
				secretAccessKey: process.env.S3_SECRET_KEY
			},
			forcePathStyle: s3ServerType === 'minio' ? true : false,
			requestHandler: new NodeHttpHandler({ httpsAgent: agent })
		})
	}
	let db
	let db_port = 6379
	if (process.env.DB_PORT) {
		db_port = process.env.DB_PORT
	}
	if (production) {
		db = await createClient({
			url: 'redis://default:' + process.env.DB_PWD  + '@' + process.env.DB_HOST + ':' + db_port
		}).on('error', function (err) {
			console.log('redis: ', err)
		}).connect()
	} else {
		db = await createClient({
			url: 'redis://localhost:' + db_port
		}).on('error', function (err) {
			console.log('redis: ' + err)
		}).connect()
	}

	let storeOptions, cookie, dureeSession, domainesAutorises
	if (production) {
		storeOptions = {
			host: process.env.DB_HOST,
			port: db_port,
			pass: process.env.DB_PWD,
			client: db,
			prefix: 'sessions:'
		}
		cookie = {
			sameSite: "Lax",
			secure: false
		}
	} else {
		storeOptions = {
			host: 'localhost',
			port: db_port,
			client: db,
			prefix: 'sessions:'
		}
		cookie = {
			secure: false
		}
	}
	const redisStore = new RedisStore(storeOptions)
	const sessionOptions = {
		secret: process.env.SESSION_KEY,
		store: redisStore,
		name: 'digistorm',
		resave: false,
		rolling: true,
		saveUninitialized: false,
		cookie: cookie
	}
	if (process.env.SESSION_DURATION) {
		dureeSession = parseInt(process.env.SESSION_DURATION)
	} else {
		dureeSession = 864000000 //3600 * 24 * 10 * 1000
	}
	const sessionMiddleware = session(sessionOptions)

	if (production && process.env.AUTHORIZED_DOMAINS) {
		domainesAutorises = process.env.AUTHORIZED_DOMAINS.split(',')
	} else {
		domainesAutorises = '*'
	}

	let earlyHints103 = false
	if (process.env.EARLY_HINTS && parseInt(process.env.EARLY_HINTS) === 1) {
		earlyHints103 = true
	}

	const transporter = nodemailer.createTransport({
		host: process.env.EMAIL_HOST,
		port: process.env.EMAIL_PORT,
		secure: process.env.EMAIL_SECURE,
		auth: {
			user: process.env.EMAIL_ADDRESS,
			pass: process.env.EMAIL_PASSWORD
		}
	})

	cron.schedule('59 23 * * Saturday', async function () {
		await fs.emptyDir(path.join(__dirname, '..', '/static/temp'))
	})

	const cleCrypto = process.env.ENCRYPTION_KEY || ''

	const validationInscription = parseInt(process.env.ACCOUNT_VALIDATION) || 0

	// Charger plugin dayjs
	dayjs.extend(localizedFormat)

	app.set('trust proxy', true)
	app.use(
		helmet({ contentSecurityPolicy: false })
	)
	app.use(bodyParser.json({ limit: '50mb' }))
	app.use(sessionMiddleware)
	app.use(cors({ 'origin': domainesAutorises }))
	if (parseInt(process.env.REVERSE_PROXY) !== 1 || !production) {
		app.use('/', express.static('static'))
	}

	if (!production) {
		const { devMiddleware } = (
      		await createDevMiddleware({ root })
    	)
    	app.use(devMiddleware)
  	} else if (production && parseInt(process.env.REVERSE_PROXY) !== 1) {
		const sirv = (await import('sirv')).default
		app.use(sirv(`${root}/dist/client`))
	}

	app.get('/', async function (req, res, next) {
		if (req.session.identifiant && req.session.role === 'utilisateur') {
			res.redirect('/u/' + req.session.identifiant)
		} else {
			let langue = 'fr'
			if (req.session.hasOwnProperty('langue') && req.session.langue !== '') {
				langue = req.session.langue
			}
			const pageContextInit = {
				urlOriginal: req.originalUrl,
				params: req.query,
				hote: req.protocol + '://' + req.get('host'),
				langues: ['fr', 'es', 'it', 'de', 'en'],
				langue: langue
			}
			const pageContext = await renderPage(pageContextInit)
			const { httpResponse } = pageContext
			if (!httpResponse) {
				return next()
			}
			const { body, statusCode, headers, earlyHints } = httpResponse
			if (earlyHints103 === true && res.writeEarlyHints) {
				res.writeEarlyHints({ link: earlyHints.map((e) => e.earlyHintLink) })
			}
			if (headers) {
				headers.forEach(([name, value]) => res.setHeader(name, value))
			}
			res.status(statusCode).send(body)
		}
	})

	app.get('/u/:utilisateur', async function (req, res, next) {
		const identifiant = req.params.utilisateur
		if (identifiant === req.session.identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			let donneesUtilisateur = await db.HGETALL('utilisateurs:' + identifiant)
			donneesUtilisateur = Object.assign({}, donneesUtilisateur)
			if (donneesUtilisateur === null || !donneesUtilisateur.hasOwnProperty('motdepasse')) { res.redirect('/'); return false }
			if (await bcrypt.compare(req.session.motdepasse, donneesUtilisateur.motdepasse)) {
				recupererDonnees(identifiant).then(function (resultat) {
					let contenusSupprimes = []
					let favorisSupprimes = []
					let interactions = resultat[0].filter(function (element) {
						if (element.hasOwnProperty('code')) {
							element.code = parseInt(element.code)
						}
						return element !== '' && Object.keys(element).length > 0
					})
					let corbeille = resultat[1].filter(function (element) {
						if (element.hasOwnProperty('code')) {
							element.code = parseInt(element.code)
							contenusSupprimes.push(element.code)
						}
						return element !== '' && Object.keys(element).length > 0
					})
					let favoris = resultat[2].filter(function (element) {
						if (element.hasOwnProperty('code')) {
							element.code = parseInt(element.code)
							if (contenusSupprimes.includes(element.code)) {
								favorisSupprimes.push(element.code)
							}
						}
						return element !== '' && Object.keys(element).length > 0 && !contenusSupprimes.includes(element.code)
					})
					const filtre = resultat[3]
					// Supprimer doublons
					interactions = interactions.filter((valeur, index, self) =>
						index === self.findIndex((t) => (
							t.code === valeur.code
						))
					)
					favoris = favoris.filter((valeur, index, self) =>
						index === self.findIndex((t) => (
							t.code === valeur.code
						))
					)
					corbeille = corbeille.filter((valeur, index, self) =>
						index === self.findIndex((t) => (
							t.code === valeur.code
						))
					)
					// Dossiers
					let contenusSupprimesDansDossiers = []
					let dossiers = []
					if (donneesUtilisateur.hasOwnProperty('dossiers')) {
						try {
							dossiers = JSON.parse(donneesUtilisateur.dossiers)
						} catch (err) {
							dossiers = []
						}
					}
					const listeInteractions = []
					dossiers.forEach(function (dossier, indexDossier) {
						dossier.contenus.forEach(function (contenu, indexContenu) {
							dossiers[indexDossier].contenus[indexContenu] = parseInt(contenu)
							if (contenusSupprimes.includes(parseInt(contenu))) {
								contenusSupprimesDansDossiers.push({ code: parseInt(contenu), dossier: dossier.id })
							}
							if (!listeInteractions.includes(parseInt(contenu)) && !contenusSupprimes.includes(parseInt(contenu))) {
								listeInteractions.push(parseInt(contenu))
							}
						})
					})
					const donneesDossiers = []
					for (const interaction of listeInteractions) {
						const donneeDossiers = new Promise(async function (resolve) {
							const resultat = await db.EXISTS('interactions:' + interaction)
							if (resultat === null || resultat === 1) {
								resolve()
							} else {
								resolve(parseInt(interaction))
							}
						})
						donneesDossiers.push(donneeDossiers)
					}
					Promise.all(donneesDossiers).then(async function (interactionsSupprimees) {
						interactionsSupprimees.forEach(function (interactionSupprimee) {
							if (interactionSupprimee !== '' || interactionSupprimee !== null) {
								dossiers.forEach(function (dossier, indexDossier) {
									if (dossier.contenus.includes(interactionSupprimee)) {
										const index = dossier.contenus.indexOf(interactionSupprimee)
										dossiers[indexDossier].contenus.splice(index, 1)
									}
								})
							}
						})
						// Préparer contenus corbeille avec favoris et dossiers
						corbeille.forEach(function (contenu, indexContenu) {
							if (favorisSupprimes.includes(contenu.code)) {
								corbeille[indexContenu].favori = true
							} else {
								corbeille[indexContenu].favori = false
							}
							if (contenusSupprimesDansDossiers.map(function (e) { return e.code }).includes(contenu.code)) {
								const index = contenusSupprimesDansDossiers.map(function (e) { return e.code }).indexOf(contenu.code)
								corbeille[indexContenu].dossier = contenusSupprimesDansDossiers[index].dossier
							} else {
								corbeille[indexContenu].dossier = ''
							}
						})
						// Supprimer doublons dans dossiers
						dossiers.forEach(function (dossier, indexDossier) {
							const interactions = []
							dossier.contenus.forEach(function (contenu, indexContenu) {
								if (!interactions.includes(contenu)) {
									interactions.push(contenu)
								} else {
									dossiers[indexDossier].contenus.splice(indexContenu, 1)
								}
							})
						})
						await db.HSET('utilisateurs:' + identifiant, 'dossiers', JSON.stringify(dossiers))
						// Supprimer contenus corbeille dans dossiers
						dossiers.forEach(function (dossier, indexDossier) {
							dossier.contenus.forEach(function () {
								dossiers[indexDossier].contenus = dossiers[indexDossier].contenus.filter(function (element) {
									return !contenusSupprimes.includes(element)
								})
							})
						})
						const pageContextInit = {
							urlOriginal: req.originalUrl,
							params: req.query,
							hote: req.protocol + '://' + req.get('host'),
							langues: ['fr', 'es', 'it', 'de', 'en'],
							identifiant: req.session.identifiant,
							nom: req.session.nom,
							email: req.session.email,
							langue: req.session.langue,
							role: req.session.role,
							interactions: interactions,
							favoris: favoris,
							corbeille: corbeille,
							dossiers: dossiers,
							filtre: filtre
						}
						envoyerPage(pageContextInit, res, next)
					})
				})
			} else {
				supprimerSession(req)
				res.redirect('/')
			}
		} else {
			supprimerSession(req)
			res.redirect('/')
		}
	})

	app.get('/c/:code', async function (req, res, next) {
		const code = parseInt(req.params.code)
		if (req.session.identifiant === '' || req.session.identifiant === undefined) {
			const identifiant = 'u' + Math.random().toString(16).slice(3)
			req.session.identifiant = identifiant
			req.session.motdepasse = ''
			req.session.nom = ''
			req.session.email = ''
			req.session.langue = 'fr'
			req.session.role = 'invite'
			req.session.interactions = []
			req.session.cookie.expires = new Date(Date.now() + dureeSession)
		}
		if (!req.session.hasOwnProperty('interactions')) {
			req.session.interactions = []
		}
		if (req.query.id && req.query.id !== '' && req.query.mdp && req.query.mdp !== '') {
			try {
				const id = decodeURIComponent(req.query.id)
				const mdpB = Rabbit.decrypt(decodeURIComponent(req.query.mdp), cleCrypto)
				const mdp = mdpB.toString(Utf8)
				const { acces, utilisateur } = await verifierAcces(code, id, mdp)
				if (acces === 'interaction_debloquee') {
					let nom = ''
					let langue = 'fr'
					if (utilisateur.hasOwnProperty('nom')) {
						nom = utilisateur.nom
					}
					if (req.session.langue && req.session.langue !== '') {
						langue = req.session.langue
					}
					if (utilisateur.hasOwnProperty('langue')) {
						langue = utilisateur.langue
					}
					req.session.identifiant = id
					req.session.motdepasse = ''
					req.session.nom = nom
					req.session.email = ''
					req.session.langue = langue
					req.session.role = 'auteur'
					if (!req.session.interactions.map(item => item.code).includes(code)) {
						req.session.interactions.push({ code: code, motdepasse: mdp })
					}
					req.session.cookie.expires = new Date(Date.now() + dureeSession)
				}
			} catch (e) {}
		}
		let pageContextInit = {}
		const reponse = await db.EXISTS('interactions:' + code)
		if (reponse === null) { 
			pageContextInit = {
				urlOriginal: req.originalUrl,
				erreur: true
			}
			envoyerPage(pageContextInit, res, next)
		} else if (reponse === 1) {
			let resultat = await db.HGETALL('interactions:' + code)
			resultat = Object.assign({}, resultat)
			if (resultat === null) { res.send('erreur'); return false }
			const type = resultat.type
			const titre = resultat.titre
			let proprietaire = ''
			let motdepasse = ''
			let donnees = {}
			let reponses = []
			let sessions = []
			let bannis = []
			const statut = resultat.statut
			const session = parseInt(resultat.session)
			let digidrive = 0
			if (await verifierAdmin(code, resultat.identifiant, req.session) === true) {
				proprietaire = resultat.identifiant
				if (resultat.hasOwnProperty('motdepasse')) {
					motdepasse = resultat.motdepasse
				}
				donnees = JSON.parse(resultat.donnees)
				reponses = JSON.parse(resultat.reponses)
				sessions = JSON.parse(resultat.sessions)
				if (resultat.hasOwnProperty('bannis')) {
					bannis = JSON.parse(resultat.bannis)
				}
				if (req.session.role === 'auteur' && resultat.hasOwnProperty('digidrive')) {
					digidrive = resultat.digidrive
				}
			} else {
				proprietaire = ''
			}
			pageContextInit = {
				urlOriginal: req.originalUrl,
				params: req.query,
				hote: req.protocol + '://' + req.get('host'),
				langues: ['fr', 'es', 'it', 'de', 'en'],
				identifiant: req.session.identifiant,
				nom: req.session.nom,
				email: req.session.email,
				langue: req.session.langue,
				role: req.session.role,
				interactions: req.session.interactions,
				type: type,
				titre: titre,
				proprietaire: proprietaire,
				motdepasse: motdepasse,
				donnees: donnees,
				reponses: reponses,
				sessions: sessions,
				bannis: bannis,
				statut: statut,
				session: session,
				digidrive: digidrive
			}
			envoyerPage(pageContextInit, res, next)
		} else {
			pageContextInit = {
				urlOriginal: req.originalUrl,
				erreur: true
			}
			envoyerPage(pageContextInit, res, next)
		}
	})

	app.get('/p/:code', async function (req, res, next) {
		if (req.session.identifiant === '' || req.session.identifiant === undefined) {
			const identifiant = 'u' + Math.random().toString(16).slice(3)
			req.session.identifiant = identifiant
			req.session.motdepasse = ''
			req.session.nom = ''
			req.session.email = ''
			req.session.langue = 'fr'
			req.session.role = 'invite'
			req.session.interactions = []
			req.session.cookie.expires = new Date(Date.now() + dureeSession)
		}
		if (!req.session.hasOwnProperty('interactions')) {
			req.session.interactions = []
		}
		const pageContextInit = {
			urlOriginal: req.originalUrl,
			params: req.query,
			hote: req.protocol + '://' + req.get('host'),
			langues: ['fr', 'es', 'it', 'de', 'en'],
			identifiant: req.session.identifiant,
			nom: req.session.nom,
			langue: req.session.langue
		}
		const pageContext = await renderPage(pageContextInit)
		const { httpResponse } = pageContext
		if (!httpResponse) {
			return next()
		}
		const { body, statusCode, headers, earlyHints } = httpResponse
		if (earlyHints103 === true && res.writeEarlyHints) {
			res.writeEarlyHints({ link: earlyHints.map((e) => e.earlyHintLink) })
		}
		if (headers) {
			headers.forEach(([name, value]) => res.setHeader(name, value))
		}
		res.status(statusCode).send(body)
	})

	app.get('/admin', async function (req, res, next) {
		let langue = 'fr'
		if (req.session.hasOwnProperty('langue') && req.session.langue !== '') {
			langue = req.session.langue
		}
		const pageContextInit = {
			urlOriginal: req.originalUrl,
			hote: req.protocol + '://' + req.get('host'),
			langue: langue
		}
		const pageContext = await renderPage(pageContextInit)
		const { httpResponse } = pageContext
		if (!httpResponse) {
			return next()
		}
		const { body, statusCode, headers, earlyHints } = httpResponse
		if (earlyHints103 === true && res.writeEarlyHints) {
			res.writeEarlyHints({ link: earlyHints.map((e) => e.earlyHintLink) })
		}
		if (headers) {
			headers.forEach(([name, value]) => res.setHeader(name, value))
		}
		res.status(statusCode).send(body)
  	})

	app.post('/api/s-inscrire', async function (req, res) {
		const identifiant = req.body.identifiant
		if (identifiant.match(/^[\w-]+$/)) {
			const motdepasse = req.body.motdepasse
			const email = req.body.email.toLowerCase()
			let reponse = await db.EXISTS('utilisateurs:' + identifiant)
			if (reponse === null) {
				res.send('erreur'); return false
			} else if (reponse === 0) {
				reponse = await db.EXISTS('emails:' + email)
				if (reponse === null) {
					res.send('erreur'); return false
				} else if (reponse === 0 && validationInscription === 1) {
					let codeActivation = randomBytes(18)
					codeActivation = codeActivation.toString('hex')
					const hash = await bcrypt.hash(motdepasse, 10)
					const date = dayjs().format()
					let langue = 'fr'
					if (req.session && req.session.hasOwnProperty('langue') && req.session.langue !== '') {
						langue = req.session.langue
					}
					await db
					.multi()
					.HSET('activations:' + codeActivation, ['id', identifiant, 'motdepasse', hash, 'date', date, 'email', email, 'langue', langue])
					.EXPIRE('activations:' + codeActivation, 43200)
					.exec()
					const message = {
						from: '"La Digitale" <' + process.env.EMAIL_ADDRESS + '>',
						to: '"Moi" <' + email + '>',
						subject: 'Activation de votre compte Digistorm',
						html: '<p>Vous avez créé un compte Digistorm ayant pour identifiant : <strong>' + identifiant + '</strong></p><p>Cliquez sur ce lien pour activer votre compte : <a href="' + hote + '/activation/' + codeActivation + '" target="_blank">' + hote + '/activation/' + codeActivation + '</a>.</p><p>Veuillez ignorer ce message si vous n\'êtes pas à l\'origine de cette création de compte.</p><p>La Digitale</p>'
					}
					transporter.sendMail(message, async function (err) {
						if (err) {
							res.send('erreur_email')
						} else {
							res.send('activation_demandee')
						}
					})
				} else if (reponse === 0 && validationInscription === 0) {
					const hash = await bcrypt.hash(motdepasse, 10)
					const date = dayjs().format()
					let langue = 'fr'
					if (req.session && req.session.hasOwnProperty('langue') && req.session.langue !== '') {
						langue = req.session.langue
					}
					await db
					.multi()
					.HSET('utilisateurs:' + identifiant, ['id', identifiant, 'email', email, 'motdepasse', hash, 'date', date, 'nom', '', 'langue', langue])
					.HSET('emails:' + email, 'identifiant', identifiant)
					.exec()
					req.session.identifiant = identifiant
					req.session.motdepasse = motdepasse
					req.session.nom = ''
					req.session.email = email
					if (req.session.langue === '' || req.session.langue === undefined) {
						req.session.langue = 'fr'
					}
					req.session.role = 'utilisateur'
					req.session.cookie.expires = new Date(Date.now() + dureeSession)
					res.send('compte_cree')
				} else {
					res.send('email_existe_deja')
				}
			} else {
				res.send('utilisateur_existe_deja')
			}
		} else {
			res.send('identifiant_invalide')
		}
	})

	app.get('/activation/:code', async function (req, res) {
		if (validationInscription === 0) {
			res.redirect('/')
			return false
		}
		const codeActivation = req.params.code
		let reponse = await db.EXISTS('activations:' + codeActivation)
		if (reponse === null) {
			res.redirect('/')
		} else if (reponse === 1) {
			let donnees = await db.HGETALL('activations:' + codeActivation)
			donnees = Object.assign({}, donnees)
			if (donnees === null) { res.redirect('/'); return false }
			const identifiant = donnees.id
			const email = donnees.email
			const motdepasse = donnees.motdepasse
			const date = donnees.date
			const langue = donnees.langue
			let reponse = await db.EXISTS('utilisateurs:' + identifiant)
			if (reponse === 0) {
				reponse = await db.EXISTS('emails:' + email)
				if (reponse === 0) {
					await db
					.multi()
					.HSET('utilisateurs:' + identifiant, ['id', identifiant, 'email', email, 'motdepasse', motdepasse, 'date', date, 'nom', '', 'langue', langue])
					.HSET('emails:' + email, 'identifiant', identifiant)
					.UNLINK('activations:' + codeActivation)
					.exec()
					const pageContextInit = {
						urlOriginal: req.originalUrl,
						hote: req.protocol + '://' + req.get('host'),
						langue: langue
					}
					const pageContext = await renderPage(pageContextInit)
					if (pageContext.errorWhileRendering) {
						if (!pageContext.httpResponse) {
							throw pageContext.errorWhileRendering
						}
					}
					const { httpResponse } = pageContext
					if (!httpResponse) {
						return next()
					}
					const { body, statusCode, headers, earlyHints } = httpResponse
					if (earlyHints103 === true && res.writeEarlyHints) {
						res.writeEarlyHints({ link: earlyHints.map((e) => e.earlyHintLink) })
					}
					if (headers) {
						headers.forEach(([name, value]) => res.setHeader(name, value))
					}
					res.status(statusCode).send(body)
				} else {
					res.redirect('/')
				}
			} else {
				res.redirect('/')
			}
		} else {
			res.redirect('/')
		}
	})

	app.post('/api/se-connecter', async function (req, res) {
		const identifiant = req.body.identifiant
		const motdepasse = req.body.motdepasse
		const reponse = await db.EXISTS('utilisateurs:' + identifiant)
		if (reponse === null) { res.send('erreur_connexion'); return false }
		if (reponse === 1) {
			let donnees = await db.HGETALL('utilisateurs:' + identifiant)
			donnees = Object.assign({}, donnees)
			if (donnees === null) { res.send('erreur_connexion'); return false }
			let comparaison = false
			if (motdepasse.trim() !== '' && donnees.hasOwnProperty('motdepasse') && donnees.motdepasse.trim() !== '') {
				comparaison = await bcrypt.compare(motdepasse, donnees.motdepasse)
			}
			let comparaisonTemp = false
			if (donnees.hasOwnProperty('motdepassetemp') && donnees.motdepassetemp.trim() !== '' && motdepasse.trim() !== '') {
				comparaisonTemp = await bcrypt.compare(motdepasse, donnees.motdepassetemp)
			}
			if (comparaison === true || comparaisonTemp === true) {
				if (comparaisonTemp === true) {
					const hash = await bcrypt.hash(motdepasse, 10)
					await db.HSET('utilisateurs:' + identifiant, 'motdepasse', hash)
					await db.HDEL('utilisateurs:' + identifiant, 'motdepassetemp')
				}
				const nom = donnees.nom
				const langue = donnees.langue
				req.session.identifiant = identifiant
				req.session.motdepasse = motdepasse
				req.session.nom = nom
				req.session.langue = langue
				req.session.role = 'utilisateur'
				req.session.cookie.expires = new Date(Date.now() + dureeSession)
				let email = ''
				if (donnees.hasOwnProperty('email')) {
					email = donnees.email
				}
				req.session.email = email
				res.json({ identifiant: identifiant })
			} else {
				res.send('erreur_connexion')
			}
		} else {
			res.send('erreur_connexion')
		}
	})

	app.post('/api/mot-de-passe-oublie', async function (req, res) {
		const identifiant = req.body.identifiant
		let email = req.body.email.toLowerCase().trim()
		const reponse = await db.EXISTS('utilisateurs:' + identifiant)
		if (reponse === null) { res.send('erreur'); return false }
		if (reponse === 1) {
			let donnees = await db.HGETALL('utilisateurs:' + identifiant)
			donnees = Object.assign({}, donnees)
			if (donnees === null) { res.send('erreur'); return false }
			if ((donnees.hasOwnProperty('email') && donnees.email.toLowerCase() === email) || (verifierEmail(identifiant) === true)) {
				if (!donnees.hasOwnProperty('email') || (donnees.hasOwnProperty('email') && donnees.email === '')) {
					email = identifiant
				}
				const motdepasse = genererMotDePasse(7)
				const message = {
					from: '"La Digitale" <' + process.env.EMAIL_ADDRESS + '>',
					to: email,
					subject: 'Mot de passe Digistorm',
					html: '<p>Votre nouveau mot de passe : ' + motdepasse + '</p>'
				}
				transporter.sendMail(message, async function (err) {
					if (err) {
						res.send('erreur_email')
					} else {
						const hash = await bcrypt.hash(motdepasse, 10)
						await db.HSET('utilisateurs:' + identifiant, 'motdepassetemp', hash)
						res.send('message_envoye')
					}
				})
			} else {
				res.send('email_invalide')
			}
		} else {
			res.send('identifiant_invalide')
		}
	})

	app.post('/api/se-deconnecter', function (req, res) {
		req.session.identifiant = ''
		req.session.motdepasse = ''
		req.session.nom = ''
		req.session.email = ''
		req.session.langue = ''
		req.session.role = ''
		req.session.interactions = []
		req.session.destroy()
		res.send('deconnecte')
	})

	app.post('/api/modifier-langue', function (req, res) {
		const langue = req.body.langue
		req.session.langue = langue
		res.send('langue_modifiee')
	})

	app.post('/api/modifier-nom', function (req, res) {
		const nom = req.body.nom
		req.session.nom = nom
		res.send('nom_modifie')
	})

	app.post('/api/generer-nom', function (req, res) {
		const generateur = new NameForgeJS()
		const noms = generateur.generateNames()
		const nom = noms[0].replace(/(^\w{1})|(\s+\w{1})/g, lettre => lettre.toUpperCase())
		req.session.nom = nom
		res.send(nom)
	})

	app.post('/api/modifier-filtre', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			let donneesUtilisateur = await db.HGETALL('utilisateurs:' + identifiant)
			donneesUtilisateur = Object.assign({}, donneesUtilisateur)
			if (donneesUtilisateur === null || !donneesUtilisateur.hasOwnProperty('motdepasse')) { res.send('erreur'); return false }
			if (await bcrypt.compare(req.session.motdepasse, donneesUtilisateur.motdepasse)) {
				const filtre = req.body.filtre
				await db.HSET('utilisateurs:' + identifiant, 'filtre', filtre)
				res.send('filtre_modifie')
			} else {
				res.send('non_autorise')
			}
		} else {
			supprimerSession(req)
			res.send('non_connecte')
		}
	})

	app.post('/api/modifier-informations-utilisateur', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			let donneesUtilisateur = await db.HGETALL('utilisateurs:' + identifiant)
			donneesUtilisateur = Object.assign({}, donneesUtilisateur)
			if (donneesUtilisateur === null || !donneesUtilisateur.hasOwnProperty('motdepasse')) { res.send('erreur'); return false }
			if (await bcrypt.compare(req.session.motdepasse, donneesUtilisateur.motdepasse)) {
				const nom = req.body.nom
				const email = req.body.email.toLowerCase()
				await db.HSET('utilisateurs:' + identifiant, ['nom', nom, 'email', email])
				req.session.nom = nom
				req.session.email = email
				res.send('utilisateur_modifie')
			} else {
				res.send('non_autorise')
			}
		} else {
			supprimerSession(req)
			res.send('non_connecte')
		}
	})

	app.post('/api/modifier-mot-de-passe-utilisateur', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur') {
			let donneesUtilisateur = await db.HGETALL('utilisateurs:' + identifiant)
			donneesUtilisateur = Object.assign({}, donneesUtilisateur)
			if (donneesUtilisateur === null || !donneesUtilisateur.hasOwnProperty('motdepasse')) { res.send('erreur'); return false }
			const motdepasse = req.body.motdepasse
			const nouveaumotdepasse = req.body.nouveaumotdepasse
			if (motdepasse.trim() !== '' && nouveaumotdepasse.trim() !== '' && donneesUtilisateur.hasOwnProperty('motdepasse') && donneesUtilisateur.motdepasse.trim() !== '' && await bcrypt.compare(motdepasse, donneesUtilisateur.motdepasse)) {
				const hash = await bcrypt.hash(nouveaumotdepasse, 10)
				await db.HSET('utilisateurs:' + identifiant, 'motdepasse', hash)
				req.session.motdepasse = nouveaumotdepasse
				res.send('motdepasse_modifie')
			} else {
				res.send('motdepasse_incorrect')
			}
		} else {
			res.send('non_connecte')
		}
	})

	app.post('/api/verifier-mot-de-passe-admin', function (req, res) {
		const admin = req.body.admin
		if (admin !== '' && admin === process.env.ADMIN_PASSWORD) {
			res.send('acces_verifie')
		} else {
			res.send('acces_invalide')
		}
	})

	app.post('/api/modifier-mot-de-passe-admin', async function (req, res) {
		const admin = req.body.admin
		if (admin !== '' && admin === process.env.ADMIN_PASSWORD) {
			const identifiant = req.body.identifiant
			const email = req.body.email.toLowerCase()
			if (identifiant !== '') {
				const resultat = await db.EXISTS('utilisateurs:' + identifiant)
				if (resultat === null) { res.send('erreur'); return false }
				if (resultat === 1) {
					const hash = await bcrypt.hash(req.body.motdepasse, 10)
					await db.HSET('utilisateurs:' + identifiant, 'motdepasse', hash)
					res.send('motdepasse_modifie')
				} else {
					res.send('identifiant_non_valide')
				}
			} else if (email !== '') {
				const utilisateurs = await db.KEYS('utilisateurs:*')
				if (utilisateurs !== null) {
					const donneesUtilisateurs = []
					utilisateurs.forEach(function (utilisateur) {
						const donneesUtilisateur = new Promise(async function (resolve) {
							let donnees = await db.HGETALL('utilisateurs:' + utilisateur.substring(13))
							donnees = Object.assign({}, donnees)
							if (donnees === null) { resolve({}); return false }
							if (donnees.hasOwnProperty('email')) {
								resolve({ identifiant: utilisateur.substring(13), email: donnees.email.toLowerCase() })
							} else {
								resolve({})
							}
						})
						donneesUtilisateurs.push(donneesUtilisateur)
					})
					Promise.all(donneesUtilisateurs).then(async function (donnees) {
						let utilisateurId = ''
						donnees.forEach(function (utilisateur) {
							if (utilisateur.hasOwnProperty('email') && utilisateur.email.toLowerCase() === email.toLowerCase()) {
								utilisateurId = utilisateur.identifiant
							}
						})
						if (utilisateurId !== '') {
							const hash = await bcrypt.hash(req.body.motdepasse, 10)
							await db.HSET('utilisateurs:' + utilisateurId, 'motdepasse', hash)
							res.send(utilisateurId)
						} else {
							res.send('email_non_valide')
						}
					})
				} else {
					res.send('erreur')
				}
			}
		}
	})

	app.post('/api/recuperer-donnees-interaction-admin', async function (req, res) {
		const code = parseInt(req.body.code)
		const admin = req.body.admin
		if (admin !== '' && admin === process.env.ADMIN_PASSWORD) {
			const resultat = await db.EXISTS('interactions:' + code)
			if (resultat === null) { res.send('erreur'); return false }
			if (resultat === 1) {
				let donnees = await db.HGETALL('interactions:' + code)
				donnees = Object.assign({}, donnees)
				if (donnees === null) { res.send('erreur'); return false }
				res.json(donnees)
			} else {
				res.send('interaction_inexistante')
			}
		}
	})

	app.post('/api/modifier-donnees-interaction-admin', async function (req, res) {
		const code = parseInt(req.body.code)
		const champ = req.body.champ
		const valeur = req.body.valeur
		const admin = req.body.admin
		if (admin !== '' && admin === process.env.ADMIN_PASSWORD) {
			const resultat = await db.EXISTS('interactions:' + code)
			if (resultat === null) { res.send('erreur'); return false }
			if (resultat === 1) {
				await db.HSET('interactions:' + code, champ, valeur)
				res.send('donnees_modifiees')
			} else {
				res.send('interaction_inexistante')
			}
		}
	})

	app.post('/api/modifier-langue-utilisateur', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant) {
			const langue = req.body.langue
			await db.HSET('utilisateurs:' + identifiant, 'langue', langue)
			req.session.langue = langue
			res.send('langue_modifiee')
		} else {
			res.send('non_connecte')
		}
	})

	app.post('/api/supprimer-compte', async function (req, res) {
		const identifiant = req.body.identifiant
		const motdepasseAdmin = req.body.admin
		const motdepasseEnvAdmin = process.env.ADMIN_PASSWORD
		let admin = false
		if (motdepasseAdmin !== '' && motdepasseAdmin === motdepasseEnvAdmin) {
			admin = true
		}
		if ((req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') || admin) {
			let donneesUtilisateur = await db.HGETALL('utilisateurs:' + identifiant)
			donneesUtilisateur = Object.assign({}, donneesUtilisateur)
			if (donneesUtilisateur === null || !donneesUtilisateur.hasOwnProperty('motdepasse')) { res.send('erreur'); return false }
			if (admin || await bcrypt.compare(req.session.motdepasse, donneesUtilisateur.motdepasse)) {
				const email = donneesUtilisateur.email
				const interactions = await db.SMEMBERS('interactions-creees:' + identifiant)
				if (interactions === null) { res.send('erreur'); return false }
				const donneesInteractions = []
				for (const interaction of interactions) {
					const donneesInteraction = new Promise(async function (resolve) {
						await db.UNLINK('interactions:' + interaction)
						const chemin = path.join(__dirname, '..', '/static/fichiers/' + interaction)
						if (stockage === 'fs' && await fs.pathExists(chemin)) {
							await fs.remove(chemin)
						} else if (stockage === 's3') {
							const liste = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: interaction + '/' }))
							if (liste !== null && liste.hasOwnProperty('Contents') && liste.Contents instanceof Array) {
								for (let i = 0; i < liste.Contents.length; i++) {
									await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: liste.Contents[i].Key }))
								}
							}
						}
						resolve(interaction)
					})
					donneesInteractions.push(donneesInteraction)
				}
				Promise.all(donneesInteractions).then(async function () {
					await db
					.multi()
					.UNLINK('interactions-creees:' + identifiant)
					.UNLINK('favoris:' + identifiant)
					.UNLINK('interactions-supprimees:' + identifiant)
					.UNLINK('utilisateurs:' + identifiant)
					.UNLINK('emails:' + email)
					.exec()
					if (!admin) {
						req.session.identifiant = ''
						req.session.motdepasse = ''
						req.session.nom = ''
						req.session.email = ''
						req.session.langue = ''
						req.session.role = ''
						req.session.interactions = []
						req.session.destroy()
						res.send('compte_supprime')
					} else {
						const sessions = await db.KEYS('sessions:*')
						if (sessions !== null) {
							const donneesSessions = []
							sessions.forEach(function (session) {
								const donneesSession = new Promise(async function (resolve) {
									let donnees = await db.GET('sessions:' + session.substring(9))
									if (donnees === null) { resolve({}); return false }
									donnees = JSON.parse(donnees)
									if (donnees.hasOwnProperty('identifiant')) {
										resolve({ session: session.substring(9), identifiant: donnees.identifiant })
									} else {
										resolve({})
									}
								})
								donneesSessions.push(donneesSession)
							})
							Promise.all(donneesSessions).then(async function (donnees) {
								let sessionId = ''
								donnees.forEach(function (item) {
									if (item.hasOwnProperty('identifiant') && item.identifiant === identifiant) {
										sessionId = item.session
									}
								})
								if (sessionId !== '') {
									await db.UNLINK('sessions:' + sessionId)
								}
								res.send('compte_supprime')
							})
						} else {
							res.send('erreur')
						}
					}
				})
			} else {
				res.send('non_autorise')
			}
		} else {
			res.send('non_connecte')
		}
	})

	app.post('/api/rejoindre-interaction', async function (req, res) {
		const code = parseInt(req.body.code)
		const reponse = await db.EXISTS('interactions:' + code)
		if (reponse === null) { res.send('erreur'); return false }
		if (reponse === 1) {
			if (req.session.identifiant === '' || req.session.identifiant === undefined) {
				const identifiant = 'u' + Math.random().toString(16).slice(3)
				req.session.identifiant = identifiant
				req.session.motdepasse = ''
				req.session.nom = ''
				req.session.email = ''
				req.session.langue = 'fr'
				req.session.role = 'invite'
				req.session.interactions = []
				req.session.cookie.expires = new Date(Date.now() + dureeSession)
			}
			res.json({ code: code, identifiant: req.session.identifiant })
		} else {
			res.send('erreur_code')
		}
	})

	app.post('/api/creer-interaction', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			let donneesUtilisateur = await db.HGETALL('utilisateurs:' + identifiant)
			donneesUtilisateur = Object.assign({}, donneesUtilisateur)
			if (donneesUtilisateur === null || !donneesUtilisateur.hasOwnProperty('motdepasse')) { res.send('erreur'); return false }
			if (await bcrypt.compare(req.session.motdepasse, donneesUtilisateur.motdepasse)) {
				const titre = req.body.titre
				const type = req.body.type
				const code = Math.floor(1000000 + Math.random() * 9000000)
				const date = dayjs().format()
				const reponse = await db.EXISTS('interactions:' + code)
				if (reponse === null) { res.send('erreur'); return false }
				if (reponse === 0) {
					await db
					.multi()
					.HSET('interactions:' + code, ['type', type, 'titre', titre, 'code', code, 'identifiant', identifiant, 'motdepasse', '', 'donnees', JSON.stringify({}), 'reponses', JSON.stringify({}), 'sessions', JSON.stringify({}), 'statut', '', 'session', 1, 'date', date, 'digidrive', 0])
					.SADD('interactions-creees:' + identifiant, code.toString())
					.exec()
					if (stockage === 'fs') {
						const chemin = path.join(__dirname, '..', '/static/fichiers/' + code)
						await fs.mkdirp(chemin)
					}
					const destination = req.body.dossier
					if (destination !== '') {
						const dossiers = JSON.parse(donneesUtilisateur.dossiers)
						dossiers.forEach(function (dossier, indexDossier) {
							if (dossier.id === destination) {
								dossiers[indexDossier].contenus.push(code)
							}
						})
						await db.HSET('utilisateurs:' + identifiant, 'dossiers', JSON.stringify(dossiers))
					}
					res.json({ code: code })
				} else {
					res.send('existe_deja')
				}
			} else {
				res.send('non_autorise')
			}
		} else {
			supprimerSession(req)
			res.send('non_connecte')
		}
	})

	app.post('/api/creer-interaction-sans-compte', async function (req, res) {
		if (req.session.identifiant === '' || req.session.identifiant === undefined || (req.session.identifiant.length !== 13 && req.session.identifiant.substring(0, 1) !== 'u')) {
			const identifiant = 'u' + Math.random().toString(16).slice(3)
			req.session.identifiant = identifiant
		}
		if (!req.session.hasOwnProperty('interactions')) {
			req.session.interactions = []
		}
		const titre = req.body.titre
		const type = req.body.type
		const code = Math.floor(1000000 + Math.random() * 9000000)
		const motdepasse = creerMotDePasse()
		const date = dayjs().format()
		const reponse = await db.EXISTS('interactions:' + code)
		if (reponse === null) { res.send('erreur'); return false }
		if (reponse === 0) {
			await db.HSET('interactions:' + code, ['type', type, 'titre', titre, 'code', code, 'motdepasse', motdepasse, 'donnees', JSON.stringify({}), 'reponses', JSON.stringify({}), 'sessions', JSON.stringify({}), 'statut', '', 'session', 1, 'date', date, 'digidrive', 0])
			if (stockage === 'fs') {
				const chemin = path.join(__dirname, '..', '/static/fichiers/' + code)
				await fs.mkdirp(chemin)
			}
			req.session.nom = ''
			req.session.email = ''
			if (req.session.langue === '' || req.session.langue === undefined) {
				req.session.langue = 'fr'
			}
			req.session.role = 'auteur'
			req.session.interactions.push({ code: code, motdepasse: motdepasse })
			req.session.cookie.expires = new Date(Date.now() + dureeSession)
			res.json({ code: code })
		} else {
			res.send('existe_deja')
		}
	})

	app.post('/api/modifier-interaction', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant) {
			const code = parseInt(req.body.code)
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { res.send('erreur'); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { res.send('erreur'); return false }
				if (await verifierAdmin(code, resultat.identifiant, req.session) === false) {
					res.send('non_autorise')
					return false
				}
				const titre = req.body.titre
				const type = resultat.type
				const donnees = req.body.donnees
				const donneesActuelles = JSON.parse(resultat.donnees)
				const fichiersActuels = []
				const fichiers = []
				const corbeille = []
				if (Object.keys(donneesActuelles).length > 0) {
					if (Object.keys(donneesActuelles.support).length > 0) {
						if (donneesActuelles.support.hasOwnProperty('fichier') && donneesActuelles.support.fichier !== '') {
							fichiersActuels.push(donneesActuelles.support.fichier)
						} else if (donneesActuelles.support.hasOwnProperty('image') && donneesActuelles.support.image !== '') {
							fichiersActuels.push(donneesActuelles.support.image)
						}
					}
					if (type === 'Sondage' || type === 'Questionnaire') {
						donneesActuelles.questions.forEach(function (q) {
							if (Object.keys(q.support).length > 0) {
								if (q.support.hasOwnProperty('fichier') && q.support.fichier !== '') {
									fichiersActuels.push(q.support.fichier)
								} else if (q.support.hasOwnProperty('image') && q.support.image !== '') {
									fichiersActuels.push(q.support.image)
								} else if (q.support.hasOwnProperty('audio') && q.support.audio !== '') {
									fichiersActuels.push(q.support.audio)
								}
							}
							if (q.hasOwnProperty('items')) {
								q.items.forEach(function (item) {
									if (item.hasOwnProperty('image') && item.image !== '') {
										fichiersActuels.push(item.image)
									}
									if (item.hasOwnProperty('audio') && item.audio !== '') {
										fichiersActuels.push(item.audio)
									}
								})
							}
						})
					} else if (type === 'Remue-méninges') {
						donneesActuelles.categories.forEach(function (categorie) {
							if (categorie.image !== '') {
								fichiersActuels.push(categorie.image)
							}
						})
					}
					if (Object.keys(donnees.support).length > 0) {
						if (donnees.support.hasOwnProperty('fichier') && donnees.support.fichier !== '') {
							fichiers.push(donnees.support.fichier)
						} else if (donnees.support.hasOwnProperty('image') && donnees.support.image !== '') {
							fichiers.push(donnees.support.image)
						}
					}
					if (type === 'Sondage' || type === 'Questionnaire') {
						donnees.questions.forEach(function (q) {
							if (Object.keys(q.support).length > 0) {
								if (q.support.hasOwnProperty('fichier') && q.support.fichier !== '') {
									fichiers.push(q.support.fichier)
								} else if (q.support.hasOwnProperty('image') && q.support.image !== '') {
									fichiers.push(q.support.image)
								} else if (q.support.hasOwnProperty('audio') && q.support.audio !== '') {
									fichiers.push(q.support.audio)
								}
							}
							if (q.hasOwnProperty('items')) {
								q.items.forEach(function (item) {
									if (item.hasOwnProperty('image') && item.image !== '') {
										fichiers.push(item.image)
									}
									if (item.hasOwnProperty('audio') && item.audio !== '') {
										fichiers.push(item.audio)
									}
								})
							}
						})
					} else if (type === 'Remue-méninges') {
						donnees.categories.forEach(function (categorie) {
							if (categorie.image !== '') {
								fichiers.push(categorie.image)
							}
						})
					}
					fichiersActuels.forEach(function (fichier) {
						if (!fichiers.includes(fichier)) {
							corbeille.push(fichier)
						}
					})
				}
				await db.HSET('interactions:' + code, ['titre', titre, 'donnees', JSON.stringify(donnees)])
				if (corbeille.length > 0) {
					corbeille.forEach(function (fichier) {
						supprimerFichier(code, fichier)
					})
				}
				res.send('donnees_enregistrees')
			} else {
				res.send('erreur_code')
			}
		} else {
			res.send('non_autorise')
		}
	})

	app.post('/api/modifier-statut-interaction', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant) {
			const code = parseInt(req.body.code)
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { res.json({ message: 'erreur' }); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { res.json({ message: 'erreur' }); return false }
				if (await verifierAdmin(code, resultat.identifiant, req.session) === false) {
					res.json({ message: 'non_autorise' })
					return false
				}
				const statut = req.body.statut
				if (statut === 'ouvert') {
					const date = dayjs().format()
					const session = resultat.session
					const sessions = JSON.parse(resultat.sessions)
					if (sessions[session] && Object.keys(sessions[session]).length > 0) {
						await db.HSET('interactions:' + code, 'statut', statut)
						res.json({ message: 'statut_modifie' })
					} else {
						sessions[session] = {}
						sessions[session].debut = date
						if ((resultat.type === 'Questionnaire' || resultat.type === 'Sondage') && (resultat.statut === ''  || resultat.statut === 'attente' || resultat.statut === 'termine')) {
							const donnees = JSON.parse(resultat.donnees)
							if (donnees.options && donnees.options.hasOwnProperty('questionsAleatoires') && donnees.options.questionsAleatoires === true) {
								donnees.questions = melanger(donnees.questions)
							}
							if (donnees.options && donnees.options.hasOwnProperty('itemsAleatoires') && donnees.options.itemsAleatoires === true) {
								donnees.questions.forEach(function (question) {
									if (question.hasOwnProperty('items')) {
										question.items = melanger(question.items)
									}
								})
							}
							sessions[session].donnees = donnees
							await db.HSET('interactions:' + code, ['statut', statut, 'sessions', JSON.stringify(sessions)])
							res.json({ message: 'statut_modifie', donnees: donnees })
						} else {
							await db.HSET('interactions:' + code, ['statut', statut, 'sessions', JSON.stringify(sessions)])
							res.json({ message: 'statut_modifie' })
						}
					}
				} else {
					await db.HSET('interactions:' + code, 'statut', statut)
					res.json({ message: 'statut_modifie' })
				}
			} else {
				res.json({ message: 'erreur_code' })
			}
		} else {
			res.json({ message: 'non_autorise' })
		}
	})

	app.post('/api/modifier-index-question', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant) {
			const code = parseInt(req.body.code)
			const indexQuestion = req.body.indexQuestion
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { res.send('erreur'); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { res.send('erreur'); return false }
				if (await verifierAdmin(code, resultat.identifiant, req.session) === false) {
					res.send('non_autorise')
					return false
				}
				const donnees = JSON.parse(resultat.donnees)
				donnees.indexQuestion = indexQuestion
				const session = resultat.session
				const sessions = JSON.parse(resultat.sessions)
				if (sessions[session] && sessions[session].hasOwnProperty('donnees') && Object.keys(sessions[session].donnees).length > 0) {
					sessions[session].donnees.indexQuestion = indexQuestion
					await db.HSET('interactions:' + code, ['donnees', JSON.stringify(donnees), 'sessions', JSON.stringify(sessions)])
				} else {
					await db.HSET('interactions:' + code, 'donnees', JSON.stringify(donnees))
				}
				res.send('index_modifie')
			} else {
				res.send('erreur_code')
			}
		} else {
			res.send('non_autorise')
		}
	})

	app.post('/api/fermer-interaction', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant) {
			const code = parseInt(req.body.code)
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { res.send('erreur'); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { res.send('erreur'); return false }
				if (await verifierAdmin(code, resultat.identifiant, req.session) === false) {
					res.send('non_autorise')
					return false
				}
				const date = dayjs().format()
				let session = resultat.session
				const type = resultat.type
				const donnees = JSON.parse(resultat.donnees)
				const reponses = JSON.parse(resultat.reponses)
				const sessions = JSON.parse(resultat.sessions)
				if (reponses[session] && reponses[session].length > 0 && sessions[session]) {
					sessions[session].fin = date
					if (!sessions[session].hasOwnProperty('donnees')) {
						sessions[session].donnees = donnees
					}
					if (type === 'Questionnaire') {
						sessions[session].classement = req.body.classement
					}
					let bannis = []
					if (resultat.hasOwnProperty('bannis')) {
						bannis = JSON.parse(resultat.bannis)
					}
					sessions[session].bannis = bannis
				} else if (sessions[session]) {
					delete sessions[session]
				}
				session = parseInt(session) + 1
				if (type === 'Questionnaire') {
					donnees.indexQuestion = donnees.copieIndexQuestion
					await db.HSET('interactions:' + code, ['statut', 'termine', 'donnees', JSON.stringify(donnees), 'sessions', JSON.stringify(sessions), 'session', session, 'bannis', JSON.stringify([])])
					res.json({ session: session, reponses: reponses, sessions: sessions })
				} else {
					await db.HSET('interactions:' + code, ['statut', 'termine', 'sessions', JSON.stringify(sessions), 'session', session, 'bannis', JSON.stringify([])])
					res.json({ session: session, reponses: reponses, sessions: sessions })
				}
			} else {
				res.send('erreur_code')
			}
		} else {
			res.send('non_autorise')
		}
	})

	app.post('/api/se-connecter-interaction', async function (req, res) {
		if (req.session.identifiant === '' || req.session.identifiant === undefined) {
			const identifiant = 'u' + Math.random().toString(16).slice(3)
			req.session.identifiant = identifiant
		}
		if (!req.session.hasOwnProperty('interactions')) {
			req.session.interactions = []
		}
		const code = parseInt(req.body.code)
		const motdepasse = req.body.motdepasse
		const reponse = await db.EXISTS('interactions:' + code)
		if (reponse === null) { res.send('erreur'); return false }
		if (reponse === 1) {
			let resultat = await db.HGETALL('interactions:' + code)
			resultat = Object.assign({}, resultat)
			if (resultat === null) { res.send('erreur'); return false }
			if (motdepasse.trim() !== '' && motdepasse.trim() === resultat.motdepasse.trim()) {
				let digidrive = 0
				if (resultat.hasOwnProperty('digidrive')) {
					digidrive = resultat.digidrive
				}
				req.session.motdepasse = ''
				req.session.nom = ''
				req.session.email = ''
				if (req.session.langue === '' || req.session.langue === undefined) {
					req.session.langue = 'fr'
				}
				req.session.role = 'auteur'
				req.session.cookie.expires = new Date(Date.now() + dureeSession)
				req.session.interactions.push({ code: code, motdepasse: motdepasse })
				res.json({ code: code, identifiant: req.session.identifiant, nom: '', role: 'auteur', interactions: req.session.interactions, donnees: resultat.donnees, reponses: resultat.reponses, sessions: resultat.sessions, digidrive: digidrive })
			} else {
				res.send('non_autorise')
			}
		} else {
			res.send('erreur_code')
		}
	})

	app.post('/api/recuperer-donnees-interaction-utilisateur', async function (req, res) {
		const code = parseInt(req.body.code)
		const identifiant = req.body.identifiant
		const reponse = await db.EXISTS('interactions:' + code)
		if (reponse === null) { res.send('erreur'); return false }
		if (reponse === 1) {
			let resultat = await db.HGETALL('interactions:' + code)
			resultat = Object.assign({}, resultat)
			if (resultat === null) { res.send('erreur'); return false }
			const type = resultat.type
			const titre = resultat.titre
			const statut = resultat.statut
			const session = parseInt(resultat.session)
			let donnees = {}
			let reponsesUtilisateurs = []
			const reponsesSession = []
			const donneesSession = []
			let bannis = []
			if (resultat.hasOwnProperty('bannis')) {
				bannis = JSON.parse(resultat.bannis)
			}
			let banni = false
			let scoreTotal = 0
			let nomObligatoire = false
			let nomAleatoire = false
			const donneesJSON = JSON.parse(resultat.donnees)
			if (donneesJSON && donneesJSON.hasOwnProperty('options') && donneesJSON.options.hasOwnProperty('nom') && donneesJSON.options.nom === 'obligatoire') {
				nomObligatoire = true
			} else if (donneesJSON && donneesJSON.hasOwnProperty('options') && donneesJSON.options.hasOwnProperty('nom') && donneesJSON.options.nom === 'aleatoire') {
				nomAleatoire = true
			}
			if (bannis.includes(identifiant)) {
				banni = true
			}
			if (statut === 'ouvert' || statut === 'nuage-affiche' || statut === 'verrouille') {
				if (donneesJSON && donneesJSON.hasOwnProperty('options') && ((donneesJSON.options.hasOwnProperty('questionsAleatoires') && donneesJSON.options.questionsAleatoires === true) || donneesJSON.options.hasOwnProperty('itemsAleatoires') && donneesJSON.options.itemsAleatoires === true)) {
					donnees = JSON.parse(resultat.sessions)[session].donnees
				} else {
					donnees = donneesJSON
				}
				const reponses = JSON.parse(resultat.reponses)
				if (reponses[session]) {
					reponsesUtilisateurs = reponses[session]
				}
				reponsesUtilisateurs.forEach(function (item) {
					if (item.identifiant === identifiant) {
						reponsesSession.push(item)
					}
				})
				if (type === 'Questionnaire') {
					if (reponsesSession[0] && reponsesSession[0].reponse) {
						reponsesSession[0].reponse.forEach(function (item, index) {
							const question = donnees.questions[index]
							const reponseCorrecte = definirReponseCorrecte(question, item).reponseCorrecte
							let itemsCorrects = []
							if (donnees.options.reponses === true || donnees.options.reponses === 'oui') {
								itemsCorrects = definirReponseCorrecte(question, item).itemsCorrects
							} else if (donnees.options.reponses === 'utilisateur') {
								itemsCorrects = definirReponseCorrecte(question, item).itemsCorrects
								itemsCorrects = itemsCorrects.filter(function (element) {
									return item.includes(element)
								})
							}
							let retroaction = ''
							if (donnees.options.retroaction === true && reponseCorrecte && question.hasOwnProperty('retroaction') && question.retroaction.correcte !== '') {
								retroaction = question.retroaction.correcte
							} else if (donnees.options.retroaction === true && !reponseCorrecte && question.hasOwnProperty('retroaction') && question.retroaction.incorrecte !== '') {
								retroaction = question.retroaction.incorrecte
							}
							donneesSession.push({ reponseCorrecte: reponseCorrecte, itemsCorrects: itemsCorrects, retroaction: retroaction })
						})
						scoreTotal = calculerScoreTotal(reponsesSession[0], donnees.options, donnees.questions)
					}
					donnees.questions.forEach(function (question) {
						if (question.hasOwnProperty('reponses')) {
							delete question.reponses
						}
						if (question.hasOwnProperty('retroaction')) {
							delete question.retroaction
						}
						if (question.hasOwnProperty('items')) {
							question.items.forEach(function (item) {
								if (item.hasOwnProperty('reponse')) {
									delete item.reponse
								}
							})
						}
					})
				}
			}
			res.json({ type: type, titre: titre, donnees: donnees, reponsesSession: reponsesSession, donneesSession: donneesSession, banni: banni, statut: statut, session: session, scoreTotal: scoreTotal, nomObligatoire: nomObligatoire, nomAleatoire: nomAleatoire })
		} else {
			res.send('interaction_inexistante')
		}
	})

	app.post('/api/telecharger-informations-interaction', async function (req, res) {
		const identifiant = req.body.identifiant
		const code = parseInt(req.body.code)
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.interactions.map(item => item.code).includes(code)) {
			const motdepasse = req.body.motdepasse
			const type = req.body.type
			const titre = req.body.titre
			const domaine = req.body.domaine
			const doc = new PDFDocument()
			const buffers = []
			doc.on('data', function (buffer) {
				buffers.push(buffer)
			})
			doc.on('end', function () {
				const buffer = Buffer.concat(buffers).toString('base64')
				res.send(buffer)
			})
			doc.fontSize(16)
			if (type === 'Sondage') {
				doc.font('Helvetica-Bold').text(t[req.session.langue].sondage + ' - ' + titre)
			} else if (type === 'Questionnaire') {
				doc.font('Helvetica-Bold').text(t[req.session.langue].questionnaire + ' - ' + titre)
			} else if (type === 'Remue-méninges') {
				doc.font('Helvetica-Bold').text(t[req.session.langue].remueMeninges + ' - ' + titre)
			} else if (type === 'Nuage-de-mots') {
				doc.font('Helvetica-Bold').text(t[req.session.langue].nuageDeMots + ' - ' + titre)
			}
			doc.moveDown()
			doc.fontSize(12)
			doc.font('Helvetica').text(t[req.session.langue].code + ' ' + code)
			doc.moveDown()
			doc.font('Helvetica').text(t[req.session.langue].lien).text(domaine + '/p/' + code, {
				link: domaine + '/p/' + code,
				underline: true
			})
			doc.moveDown()
			doc.font('Helvetica').text(t[req.session.langue].lienAdmin).text(domaine + '/c/' + code, {
				link: domaine + '/c/' + code,
				underline: true
			})
			doc.moveDown()
			doc.font('Helvetica').text(t[req.session.langue].motdepasse + ' ' + motdepasse)
			doc.moveDown()
			doc.end()
		} else {
			res.send('non_autorise')
		}
	})

	app.post('/api/ajouter-favori', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			const interaction = parseInt(req.body.code)
			if (await verifierAdmin(interaction, identifiant, req.session) === true) {
				await db.SADD('favoris:' + identifiant, interaction.toString())
				res.send('favori_ajoute')
			} else {
				res.send('non_autorise')
			}
		} else {
			res.send('non_connecte')
		}
	})

	app.post('/api/supprimer-favori', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			const interaction = parseInt(req.body.code)
			if (await verifierAdmin(interaction, identifiant, req.session) === true) {
				await db.SREM('favoris:' + identifiant, interaction.toString())
				res.send('favori_supprime')
			} else {
				res.send('non_autorise')
			}
		} else {
			res.send('non_connecte')
		}
	})

	app.post('/api/deplacer-interaction', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			let donneesUtilisateur = await db.HGETALL('utilisateurs:' + identifiant)
			donneesUtilisateur = Object.assign({}, donneesUtilisateur)
			if (donneesUtilisateur === null || !donneesUtilisateur.hasOwnProperty('motdepasse')) { res.send('erreur'); return false }
			if (identifiant === req.session.identifiant && await bcrypt.compare(req.session.motdepasse, donneesUtilisateur.motdepasse)) {
				const code = parseInt(req.body.code)
				const destination = req.body.destination
				const dossiers = JSON.parse(donneesUtilisateur.dossiers)
				dossiers.forEach(function (dossier, indexDossier) {
					if (dossier.contenus.includes(code)) {
						const index = dossier.contenus.indexOf(code)
						dossiers[indexDossier].contenus.splice(index, 1)
					}
					if (dossier.id === destination) {
						dossiers[indexDossier].contenus.push(code)
					}
				})
				await db.HSET('utilisateurs:' + identifiant, 'dossiers', JSON.stringify(dossiers))
				res.send('interaction_deplacee')
			} else {
				res.send('non_autorise')
			}
		} else {
			supprimerSession(req)
			res.send('non_connecte')
		}
	})

	app.post('/api/mettre-a-la-corbeille', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			const interaction = parseInt(req.body.code)
			if (await verifierAdmin(interaction, identifiant, req.session) === true) {
				await db
				.multi()
				.SADD('interactions-supprimees:' + identifiant, interaction.toString())
				.SREM('interactions-creees:' + identifiant, interaction.toString())
				.exec()
				res.send('interraction_supprimee')
			} else {
				res.send('non_autorise')
			}
		} else {
			res.send('non_connecte')
		}
	})

	app.post('/api/restaurer-interaction', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			const interaction = parseInt(req.body.code)
			if (await verifierAdmin(interaction, identifiant, req.session) === true) {
				await db
				.multi()
				.SREM('interactions-supprimees:' + identifiant, interaction.toString())
				.SADD('interactions-creees:' + identifiant, interaction.toString())
				.exec()
				res.send('interraction_restauree')
			} else {
				res.send('non_autorise')
			}
		} else {
			res.send('non_connecte')
		}
	})

	app.post('/api/dupliquer-interaction', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			const interaction = parseInt(req.body.code)
			const reponse = await db.EXISTS('interactions:' + interaction)
			if (reponse === null) { res.send('erreur'); return false }
			if (reponse === 1) {
				let parametres = await db.HGETALL('interactions:' + interaction)
				parametres = Object.assign({}, parametres)
				if (parametres === null) { res.send('erreur'); return false }
				let donneesUtilisateur = await db.HGETALL('utilisateurs:' + identifiant)
				donneesUtilisateur = Object.assign({}, donneesUtilisateur)
				if (donneesUtilisateur === null || !donneesUtilisateur.hasOwnProperty('motdepasse')) { res.redirect('/'); return false }
				if (parametres.identifiant !== identifiant || await bcrypt.compare(req.session.motdepasse, donneesUtilisateur.motdepasse) === false) {
					res.send('non_autorise')
					return false
				}
				const code = Math.floor(1000000 + Math.random() * 9000000)
				const date = dayjs().format()
				let resultat = await db.EXISTS('interactions:' + code)
				if (resultat === null) { res.send('erreur'); return false }
				if (resultat === 0) {
					await db
					.multi()
					.HSET('interactions:' + code, ['type', parametres.type, 'titre', t[req.session.langue].copieDe + parametres.titre, 'code', code, 'identifiant', identifiant, 'motdepasse', '', 'donnees', parametres.donnees, 'reponses', JSON.stringify({}), 'sessions', JSON.stringify({}), 'statut', '', 'session', 1, 'date', date, 'digidrive', 0])
					.SADD('interactions-creees:' + identifiant, code.toString())
					.exec()
					if (stockage === 'fs' && await fs.pathExists(path.join(__dirname, '..', '/static/fichiers/' + interaction))) {
						await fs.copy(path.join(__dirname, '..', '/static/fichiers/' + interaction), path.join(__dirname, '..', '/static/fichiers/' + code))
					} else if (stockage === 's3') {
						const liste = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: interaction + '/' }))
						if (liste !== null && liste.hasOwnProperty('Contents') && liste.Contents instanceof Array) {
							for (let i = 0; i < liste.Contents.length; i++) {
								await s3Client.send(new CopyObjectCommand({ Bucket: bucket, Key: code + '/' + liste.Contents[i].Key.replace(interaction + '/', ''), CopySource: '/' + bucket + '/' + liste.Contents[i].Key, ACL: 'public-read' }))
							}
						}
					}
					const destination = req.body.dossier
					if (destination !== '') {
						const dossiers = JSON.parse(donneesUtilisateur.dossiers)
						dossiers.forEach(function (dossier, indexDossier) {
							if (dossier.id === destination) {
								dossiers[indexDossier].contenus.push(code)
							}
						})
						await db.HSET('utilisateurs:' + identifiant, 'dossiers', JSON.stringify(dossiers))
					}
					res.json({ type: parametres.type, titre: t[req.session.langue].copieDe + parametres.titre, code: code, identifiant: identifiant, motdepasse: '', donnees: JSON.parse(parametres.donnees), reponses: {}, sessions: {}, statut: '', session: 1, date: date })
				} else {
					res.send('existe_deja')
				}
			} else {
				res.send('erreur_code')
			}
		} else {
			res.send('non_connecte')
		}
	})

	app.post('/api/exporter-interaction', async function (req, res) {
		const identifiant = req.body.identifiant
		const motdepasseAdmin = req.body.admin
		const motdepasseEnvAdmin = process.env.ADMIN_PASSWORD
		let admin = false
		if (motdepasseAdmin !== '' && motdepasseAdmin === motdepasseEnvAdmin) {
			admin = true
		}
		if ((req.session.identifiant && req.session.identifiant === identifiant && ((req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') || req.session.role === 'auteur')) || admin) {
			const code = parseInt(req.body.code)
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { res.send('erreur'); return false }
			if (reponse === 1) {
				let parametres = await db.HGETALL('interactions:' + code)
				parametres = Object.assign({}, parametres)
				if (parametres === null) { res.send('erreur'); return false }
				if (!admin && await verifierAdmin(code, parametres.identifiant, req.session) === false) {
					res.send('non_autorise')
					return false
				}
				const chemin = path.join(__dirname, '..', '/static/temp')
				await fs.mkdirp(path.normalize(chemin + '/' + code))
				await fs.mkdirp(path.normalize(chemin + '/' + code + '/fichiers'))
				await fs.writeFile(path.normalize(chemin + '/' + code + '/donnees.json'), JSON.stringify(parametres, '', 4), 'utf8')
				const donnees = JSON.parse(parametres.donnees)
				if (Object.keys(donnees).length > 0) {
					const fichiers = definirListeFichiers(parametres.type, donnees)
					for (const fichier of fichiers) {
						if (stockage === 'fs' && await fs.pathExists(path.join(__dirname, '..', '/static/fichiers/' + code + '/' + fichier))) {
							await fs.copy(path.join(__dirname, '..', '/static/fichiers/' + code + '/' + fichier), path.normalize(chemin + '/' + code + '/fichiers/' + fichier, { overwrite: true }))
						} else if (stockage === 's3') {
							try {
								const fichierMeta = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: code + '/' + fichier }))
								if (fichierMeta.hasOwnProperty('ContentLength')) {
									await telechargerFichierS3(code + '/' + fichier, path.normalize(chemin + '/' + code + '/fichiers/' + fichier))
								}
							} catch (e) {}
						}
					}
					const archiveId = Math.floor((Math.random() * 100000) + 1)
					const sortie = fs.createWriteStream(path.normalize(chemin + '/' + code + '_' + archiveId + '.zip'))
					const archive = archiver('zip', {
						zlib: { level: 9 }
					})
					sortie.on('finish', async function () {
						await fs.remove(path.normalize(chemin + '/' + code))
						res.send(code + '_' + archiveId + '.zip')
					})
					archive.pipe(sortie)
					archive.directory(path.normalize(chemin + '/' + code), false)
					archive.finalize()
				} else {
					res.send('erreur_donnees')
				}
			} else {
				res.send('erreur_code')
			}
		} else {
			res.send('non_connecte')
		}
	})

	app.post('/api/importer-interaction', async function (req, res) {
		const identifiant = req.session.identifiant
		if (identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			let donneesUtilisateur = await db.HGETALL('utilisateurs:' + identifiant)
			donneesUtilisateur = Object.assign({}, donneesUtilisateur)
			if (donneesUtilisateur === null || !donneesUtilisateur.hasOwnProperty('motdepasse')) { res.send('erreur_import'); return false }
			if (await bcrypt.compare(req.session.motdepasse, donneesUtilisateur.motdepasse)) {
				televerserArchive(req, res, async function (err) {
					if (err) { res.send('erreur_import'); return false }
					try {
						const source = path.join(__dirname, '..', '/static/temp/' + req.file.filename)
						const cible = path.join(__dirname, '..', '/static/temp/archive-' + Math.floor((Math.random() * 100000) + 1))
						await extract(source, { dir: cible })
						const donnees = await fs.readJson(path.normalize(cible + '/donnees.json'))
						const parametres = JSON.parse(req.body.parametres)
						// Vérification des clés des données
						if (donnees.hasOwnProperty('type') && donnees.hasOwnProperty('titre') && donnees.hasOwnProperty('code') && donnees.hasOwnProperty('motdepasse') && donnees.hasOwnProperty('donnees') && donnees.hasOwnProperty('reponses') && donnees.hasOwnProperty('sessions') && donnees.hasOwnProperty('statut') && donnees.hasOwnProperty('session') && donnees.hasOwnProperty('date')) {
							const code = Math.floor(1000000 + Math.random() * 9000000)
							const date = dayjs().format()
							const reponse = await db.EXISTS('interactions:' + code)
							if (reponse === null) { res.send('erreur'); return false }
							if (reponse === 0) {
								if (parametres.resultats === true) {
									await db.HSET('interactions:' + code, ['type', donnees.type, 'titre', donnees.titre, 'code', code, 'identifiant', identifiant, 'motdepasse', '', 'donnees', donnees.donnees, 'reponses', donnees.reponses, 'sessions', donnees.sessions, 'statut', '', 'session', donnees.session, 'date', date, 'digidrive', 0])
								} else {
									await db.HSET('interactions:' + code, ['type', donnees.type, 'titre', donnees.titre, 'code', code, 'identifiant', identifiant, 'motdepasse', '', 'donnees', donnees.donnees, 'reponses', JSON.stringify({}), 'sessions', JSON.stringify({}), 'statut', '', 'session', 1, 'date', date, 'digidrive', 0])
								}
								await db.SADD('interactions-creees:' + identifiant, code.toString())
								if (stockage === 'fs') {
									const chemin = path.join(__dirname, '..', '/static/fichiers/' + code)
									await fs.move(path.normalize(cible + '/fichiers'), chemin)
								} else if (stockage === 's3') {
									const d = JSON.parse(donnees.donnees)
									const fichiers = definirListeFichiers(donnees.type, d)
									for (const fichier of fichiers) {
										if (fichier !== '' && await fs.pathExists(path.normalize(cible + '/fichiers/' + fichier))) {
											const buffer = await fs.readFile(path.normalize(cible + '/fichiers/' + fichier))
											await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: code + '/' + fichier, Body: buffer, ACL: 'public-read' }))
										}
									}
								}
								if (parametres.resultats === true) {
									res.json({ type: donnees.type, titre: donnees.titre, code: code, identifiant: identifiant, motdepasse: '', donnees: JSON.parse(donnees.donnees), reponses: JSON.parse(donnees.reponses), sessions: JSON.parse(donnees.sessions), statut: '', session: donnees.session, date: date })
								} else {
									res.json({ type: donnees.type, titre: donnees.titre, code: code, identifiant: identifiant, motdepasse: '', donnees: JSON.parse(donnees.donnees), reponses: {}, sessions: {}, statut: '', session: 1, date: date })
								}
							} else {
								res.send('existe_deja')
							}
						} else {
							await fs.remove(source)
							await fs.remove(cible)
							res.send('donnees_corrompues')
						}
					} catch (err) {
						await fs.remove(path.join(__dirname, '..', '/static/temp/' + req.file.filename))
						res.send('erreur_import')
					}
				})
			} else {
				res.send('non_autorise')
			}
		} else {
			supprimerSession(req)
			res.send('non_connecte')
		}
	})

	app.post('/api/supprimer-interaction', async function (req, res) {
		const code = parseInt(req.body.code)
		const identifiant = req.body.identifiant
		const motdepasseAdmin = req.body.admin
		const motdepasseEnvAdmin = process.env.ADMIN_PASSWORD
		let admin = false
		if (motdepasseAdmin !== '' && motdepasseAdmin === motdepasseEnvAdmin) {
			admin = true
		}
		if ((req.session.identifiant && req.session.identifiant === identifiant && ((req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') || req.session.role === 'auteur')) || admin) {
			let suppressionFichiers = true
			if (req.body.hasOwnProperty('suppressionFichiers')) {
				suppressionFichiers = req.body.suppressionFichiers
			}
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { res.send('erreur'); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { res.send('erreur'); return false }
				if (!admin && await verifierAdmin(code, resultat.identifiant, req.session) === false) {
					res.send('non_autorise')
					return false
				}
				await db
				.multi()
				.UNLINK('interactions:' + code)
				.SREM('interactions-creees:' + identifiant, code.toString())
				.SREM('favoris:' + identifiant, code.toString())
				.SREM('interactions-supprimees:' + identifiant, code.toString())
				.exec()
				if (stockage === 'fs' && suppressionFichiers === true) {
					await fs.remove(path.join(__dirname, '..', '/static/fichiers/' + code))
				} else if (stockage === 's3' && suppressionFichiers === true) {
					const liste = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: code + '/' }))
					if (liste !== null && liste.hasOwnProperty('Contents') && liste.Contents instanceof Array) {
						for (let i = 0; i < liste.Contents.length; i++) {
							await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: liste.Contents[i].Key }))
						}
					}
				}
				res.send('interaction_supprimee')
			} else {
				res.send('erreur_code')
			}
		} else {
			supprimerSession(req)
			res.send('non_connecte')
		}
	})

	app.post('/api/exporter-resultat', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant) {
			const code = parseInt(req.body.code)
			let resultat = await db.HGETALL('interactions:' + code)
			resultat = Object.assign({}, resultat)
			if (resultat === null) { res.send('erreur'); return false }
			if (await verifierAdmin(code, resultat.identifiant, req.session) === false) {
				res.send('non_autorise')
				return false
			}
			const type = req.body.type
			const titre = req.body.titre
			const donnees = req.body.donnees
			const reponses = req.body.reponses
			const dateDebut = req.body.dateDebut
			const dateFin = req.body.dateFin
			const alphabet = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']
			let bannis = []
			if (req.body.bannis && req.body.bannis.length) {
				bannis = req.body.bannis
			} else if (donnees.hasOwnProperty('bannis')) {
				bannis = donnees.bannis
			}
			const doc = new PDFDocument()
			const buffers = []
			doc.on('data', function (buffer) {
				buffers.push(buffer)
			})
			doc.on('end', function () {
				const buffer = Buffer.concat(buffers).toString('base64')
				res.send(buffer)
			})
			doc.fontSize(16)
			if (type === 'Sondage') {
				doc.font('Helvetica-Bold').text(t[req.session.langue].sondage + ' - ' + titre)
			} else if (type === 'Questionnaire') {
				doc.font('Helvetica-Bold').text(t[req.session.langue].questionnaire + ' - ' + titre)
			} else if (type === 'Remue-méninges') {
				doc.font('Helvetica-Bold').text(t[req.session.langue].remueMeninges + ' - ' + titre)
			} else if (type === 'Nuage-de-mots') {
				doc.font('Helvetica-Bold').text(t[req.session.langue].nuageDeMots + ' - ' + titre)
			}
			doc.fontSize(10)
			doc.moveDown()
			if (type === 'Sondage' && typeof donnees === 'object' && donnees !== null && donnees.hasOwnProperty('questions')) {
				const statistiques = definirStatistiquesQuestions(donnees.questions, reponses, bannis)
				if (dateDebut !== '' && dateFin !== '') {
					doc.fontSize(8)
					doc.font('Helvetica').text(formaterDate(dateDebut, t[req.session.langue].demarre, req.session.langue) + ' - ' + formaterDate(dateFin, t[req.session.langue].termine, req.session.langue))
					doc.moveDown()
				}
				if (donnees.options.progression === 'libre') {
					doc.font('Helvetica').text(t[req.session.langue].progression + ' ' + t[req.session.langue].progressionLibre)
				} else {
					doc.font('Helvetica').text(t[req.session.langue].progression + ' ' + t[req.session.langue].progressionAnimateur)
				}
				doc.moveDown()
				doc.moveDown()
				if (donnees.description !== '') {
					doc.fontSize(12)
					doc.font('Helvetica-Bold').text(t[req.session.langue].description, { underline: true })
					doc.fontSize(10)
					doc.moveDown()
					doc.font('Helvetica').text(donnees.description)
				}
				if (donnees.description !== '' && Object.keys(donnees.support).length > 0) {
					doc.fontSize(12)
					doc.moveDown()
				}
				if (Object.keys(donnees.support).length > 0) {
					doc.fontSize(12)
					doc.font('Helvetica-Bold').text(t[req.session.langue].support, { underline: true })
					doc.moveDown()
					if (donnees.support.type === 'image' && donnees.support.fichier !== '') {
						let support = ''
						if (stockage === 'fs') {
							const cheminSupport = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + donnees.support.fichier)
							if (await fs.pathExists(cheminSupport)) {
								support = await fs.readFile(cheminSupport)
							}
						} else if (stockage === 's3') {
							support = await lireFichierS3(code + '/' + donnees.support.fichier)
						}
						if (support !== '' && magic.includes(support.toString('hex', 0, 4)) === true) {
							doc.image(support, { fit: [120, 120] })
						} else {
							doc.fontSize(10)
							doc.font('Helvetica').text(t[req.session.langue].image + ' ' + donnees.support.alt)
						}
					} else if (donnees.support.type === 'audio') {
						doc.fontSize(10)
						doc.font('Helvetica').text(t[req.session.langue].fichierAudio + ' ' + donnees.support.alt)
					} else if (donnees.support.type === 'video') {
						doc.fontSize(10)
						doc.font('Helvetica').text(t[req.session.langue].video, {
							link: donnees.support.lien,
							underline: true
						})
					}
				}
				if (donnees.description !== '' || Object.keys(donnees.support).length > 0) {
					doc.fontSize(12)
					doc.moveDown()
					doc.moveDown()
				}
				for (let i = 0; i < donnees.questions.length; i++) {
					doc.fontSize(14)
					doc.font('Helvetica-Bold').fillColor('black').text(t[req.session.langue].question + ' ' + (i + 1))
					doc.fontSize(10)
					doc.font('Helvetica').text('-----------------------------------------------')
					doc.fontSize(14)
					doc.moveDown()
					doc.fontSize(12)
					doc.font('Helvetica-Bold').text(t[req.session.langue].question, { underline: true })
					if (donnees.questions[i].question !== '') {
						doc.moveDown()
						doc.font('Helvetica-Bold').text(donnees.questions[i].question)
					}
					if (Object.keys(donnees.questions[i].support).length > 0 && donnees.questions[i].support.hasOwnProperty('image') && donnees.questions[i].support.image !== '') {
						doc.moveDown()
						let support = ''
						if (stockage === 'fs') {
							const cheminSupport = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + donnees.questions[i].support.image)
							if (await fs.pathExists(cheminSupport)) {
								support = await fs.readFile(cheminSupport)
							}
						} else if (stockage === 's3') {
							support = await lireFichierS3(code + '/' + donnees.questions[i].support.image)
						}
						if (support !== '' && magic.includes(support.toString('hex', 0, 4)) === true) {
							doc.image(support, { fit: [120, 120] })
						}
					} else if (Object.keys(donnees.questions[i].support).length > 0 && donnees.questions[i].support.hasOwnProperty('audio') && donnees.questions[i].support.audio !== '') {
						doc.moveDown()
						doc.font('Helvetica').text(t[req.session.langue].fichierAudio + ' ' + donnees.questions[i].support.audio)
					}
					doc.moveDown()
					doc.moveDown()
					doc.fontSize(12)
					doc.font('Helvetica-Bold').text(t[req.session.langue].reponses + ' (' + definirReponses(reponses, i, bannis) + ')', { underline: true })
					doc.moveDown()
					if (donnees.questions[i].option === 'choix-unique' || donnees.questions[i].option === 'choix-multiples') {
						for (let j = 0; j < donnees.questions[i].items.length; j++) {
							if (donnees.questions[i].items[j].texte !== '') {
								doc.fontSize(10)
								doc.font('Helvetica').text(alphabet[j] + '. ' + donnees.questions[i].items[j].texte + ' (' + statistiques[i].pourcentages[j] + '% - ' + statistiques[i].personnes[j] + ')')
								if (donnees.questions[i].items[j].hasOwnProperty('image') && donnees.questions[i].items[j].image !== '') {
									let image = ''
									if (stockage === 'fs') {
										const cheminImage = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + donnees.questions[i].items[j].image)
										if (await fs.pathExists(cheminImage)) {
											image = await fs.readFile(cheminImage)
										}
									} else if (stockage === 's3') {
										image = await lireFichierS3(code + '/' + donnees.questions[i].items[j].image)
									}
									if (image !== '' && magic.includes(image.toString('hex', 0, 4)) === true) {
										doc.image(image, { fit: [75, 75] })
									}
								} else if (donnees.questions[i].items[j].hasOwnProperty('audio') && donnees.questions[i].items[j].audio !== '') {
									doc.fontSize(10)
									doc.font('Helvetica').text(t[req.session.langue].fichierAudio + ' ' + donnees.questions[i].items[j].audio)
								}
							} else if (donnees.questions[i].items[j].hasOwnProperty('image') && donnees.questions[i].items[j].image !== '') {
								doc.fontSize(10)
								let image = ''
								if (stockage === 'fs') {
									const cheminImage = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + donnees.questions[i].items[j].image)
									if (await fs.pathExists(cheminImage)) {
										image = await fs.readFile(cheminImage)
									}
								} else if (stockage === 's3') {
									image = await lireFichierS3(code + '/' + donnees.questions[i].items[j].image)
								}
								if (image !== '' && magic.includes(image.toString('hex', 0, 4)) === true) {
									doc.font('Helvetica').text(alphabet[j] + '. (' + statistiques[i].pourcentages[j] + '% - ' + statistiques[i].personnes[j] + ')').image(image, { fit: [75, 75] })
								} else {
									doc.font('Helvetica').text(alphabet[j] + '. ' + donnees.questions[i].items[j].alt + ' (' + statistiques[i].pourcentages[j] + '% - ' + statistiques[i].personnes[j] + ')')
								}
							} else if (donnees.questions[i].items[j].hasOwnProperty('audio') && donnees.questions[i].items[j].audio !== '') {
								doc.fontSize(10)
								doc.font('Helvetica').text(alphabet[j] + '. ' + t[req.session.langue].fichierAudio + ' ' + donnees.questions[i].items[j].audio + ' (' + statistiques[i].pourcentages[j] + '% - ' + statistiques[i].personnes[j] + ')')
							}
							doc.moveDown()
						}
					} else if (donnees.questions[i].option === 'texte-court') {
						const itemsTexte = []
						reponses.forEach(function (donnees) {
							if (!bannis.includes(donnees.identifiant)) {
								donnees.reponse[i].forEach(function (reponse) {
									if (!itemsTexte.includes(reponse.toString().trim())) {
										itemsTexte.push(reponse.toString().trim())
									}
								})
							}
						})
						itemsTexte.forEach(function (item, index) {
							doc.fontSize(10)
							doc.font('Helvetica').text((index + 1) + '. ' + item + ' (' + statistiques[i].pourcentages[index] + '% - ' + statistiques[i].personnes[index] + ')')
							doc.moveDown()
						})
					} else if (donnees.questions[i].option === 'etoiles') {
						let totalPoints = 0
						let totalPersonnes = 0
						statistiques[i].personnes.forEach(function (stat, indexStat) {
							totalPoints = totalPoints + (stat * (indexStat + 1))
							totalPersonnes = totalPersonnes + stat
						})
						const moyenne = (Math.round((totalPoints / totalPersonnes) * 10) / 10) || 0
						doc.fontSize(10)
						doc.font('Helvetica').text(t[req.session.langue].moyenne + moyenne + '/' + donnees.questions[i].etoiles)
						doc.moveDown()
						for (let k = 0; k < donnees.questions[i].etoiles; k++) {
							doc.fontSize(10)
							doc.font('Helvetica').text((k + 1) + '/' + donnees.questions[i].etoiles + ' (' + statistiques[i].pourcentages[k] + '% - ' + statistiques[i].personnes[k] + ')')
							doc.moveDown()
						}
					}
					doc.moveDown()
					doc.moveDown()
				}
			} else if (type === 'Questionnaire' && typeof donnees === 'object' && donnees !== null && donnees.hasOwnProperty('questions')) {
				const statistiques = definirStatistiquesQuestions(donnees.questions, reponses, bannis)
				const classement = req.body.classement
				if (dateDebut !== '' && dateFin !== '') {
					doc.fontSize(8)
					doc.font('Helvetica').text(formaterDate(dateDebut, t[req.session.langue].demarre, req.session.langue) + ' - ' + formaterDate(dateFin, t[req.session.langue].termine, req.session.langue))
					doc.moveDown()
				}
				if (donnees.options.progression === 'libre') {
					doc.font('Helvetica').text(t[req.session.langue].progression + ' ' + t[req.session.langue].progressionLibre)
				} else {
					doc.font('Helvetica').text(t[req.session.langue].progression + ' ' + t[req.session.langue].progressionAnimateur)
				}
				doc.moveDown()
				doc.moveDown()
				if (donnees.description !== '') {
					doc.fontSize(12)
					doc.font('Helvetica-Bold').text(t[req.session.langue].description, { underline: true })
					doc.fontSize(10)
					doc.moveDown()
					doc.font('Helvetica').text(donnees.description)
				}
				if (donnees.description !== '' && Object.keys(donnees.support).length > 0) {
					doc.fontSize(12)
					doc.moveDown()
				}
				if (Object.keys(donnees.support).length > 0) {
					doc.fontSize(12)
					doc.font('Helvetica-Bold').text(t[req.session.langue].support, { underline: true })
					doc.moveDown()
					if (donnees.support.type === 'image') {
						let support = ''
						if (stockage === 'fs') {
							const cheminSupport = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + donnees.support.fichier)
							if (await fs.pathExists(cheminSupport)) {
								support = await fs.readFile(cheminSupport)
							}
						} else if (stockage === 's3') {
							support = await lireFichierS3(code + '/' + donnees.support.fichier)
						}
						if (support !== '' && magic.includes(support.toString('hex', 0, 4)) === true) {
							doc.image(support, { fit: [120, 120] })
						} else {
							doc.fontSize(10)
							doc.font('Helvetica').text(t[req.session.langue].image + ' ' + donnees.support.alt)
						}
					} else if (donnees.support.type === 'audio') {
						doc.fontSize(10)
						doc.font('Helvetica').text(t[req.session.langue].fichierAudio + ' ' + donnees.support.alt)
					} else if (donnees.support.type === 'video') {
						doc.fontSize(10)
						doc.font('Helvetica').text(t[req.session.langue].video, {
							link: donnees.support.lien,
							underline: true
						})
					}
				}
				if (donnees.description !== '' || Object.keys(donnees.support).length > 0) {
					doc.fontSize(12)
					doc.moveDown()
					doc.moveDown()
				}
				for (let i = 0; i < donnees.questions.length; i++) {
					doc.fontSize(14)
					doc.font('Helvetica-Bold').fillColor('black').text(t[req.session.langue].question + ' ' + (i + 1))
					doc.fontSize(10)
					doc.font('Helvetica').text('-----------------------------------------------')
					doc.fontSize(14)
					doc.moveDown()
					doc.fontSize(12)
					doc.font('Helvetica-Bold').text(t[req.session.langue].question, { underline: true })
					if (donnees.questions[i].question !== '') {
						doc.moveDown()
						doc.font('Helvetica-Bold').text(donnees.questions[i].question)
					}
					if (Object.keys(donnees.questions[i].support).length > 0 && donnees.questions[i].support.hasOwnProperty('image') && donnees.questions[i].support.image !== '') {
						doc.moveDown()
						let support = ''
						if (stockage === 'fs') {
							const cheminSupport = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + donnees.questions[i].support.image)
							if (await fs.pathExists(cheminSupport)) {
								support = await fs.readFile(cheminSupport)
							}
						} else if (stockage === 's3') {
							support = await lireFichierS3(code + '/' + donnees.questions[i].support.image)
						}
						if (support !== '' && magic.includes(support.toString('hex', 0, 4)) === true) {
							doc.image(support, { fit: [120, 120] })
						}
					} else if (Object.keys(donnees.questions[i].support).length > 0 && donnees.questions[i].support.hasOwnProperty('audio') && donnees.questions[i].support.audio !== '') {
						doc.moveDown()
						doc.font('Helvetica').text(t[req.session.langue].fichierAudio + ' ' + donnees.questions[i].support.audio)
					}
					doc.moveDown()
					doc.moveDown()
					doc.fontSize(12)
					doc.font('Helvetica-Bold').text(t[req.session.langue].reponses + ' (' + definirReponses(reponses, i, bannis) + ')', { underline: true })
					doc.moveDown()
					if (donnees.questions[i].option !== 'texte-court') {
						for (let j = 0; j < donnees.questions[i].items.length; j++) {
							if (donnees.questions[i].items[j].texte !== '') {
								doc.fontSize(10)
								if (donnees.questions[i].items[j].reponse === true) {
									doc.font('Helvetica').fillColor('#00a695').text(alphabet[j] + '. ' + donnees.questions[i].items[j].texte + ' (' + statistiques[i].pourcentages[j] + '% - ' + statistiques[i].personnes[j] + ') - ' + t[req.session.langue].bonneReponse)
								} else {
									doc.font('Helvetica').fillColor('grey').text(alphabet[j] + '. ' + donnees.questions[i].items[j].texte + ' (' + statistiques[i].pourcentages[j] + '% - ' + statistiques[i].personnes[j] + ')')
								}
								if (donnees.questions[i].items[j].hasOwnProperty('image') && donnees.questions[i].items[j].image !== '') {
									let image = ''
									if (stockage === 'fs') {
										const cheminImage = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + donnees.questions[i].items[j].image)
										if (await fs.pathExists(cheminImage)) {
											image = await fs.readFile(cheminImage)
										}
									} else if (stockage === 's3') {
										image = await lireFichierS3(code + '/' + donnees.questions[i].items[j].image)
									}
									if (image !== '' && magic.includes(image.toString('hex', 0, 4)) === true) {
										doc.image(image, { fit: [75, 75] })
									}
								} else if (donnees.questions[i].items[j].hasOwnProperty('audio') && donnees.questions[i].items[j].audio !== '') {
									doc.fontSize(10)
									doc.font('Helvetica').text(t[req.session.langue].fichierAudio + ' ' + donnees.questions[i].items[j].audio)
								}
							} else if (donnees.questions[i].items[j].hasOwnProperty('image') && donnees.questions[i].items[j].image !== '') {
								doc.fontSize(10)
								let image = ''
								if (stockage === 'fs') {
									const cheminImage = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + donnees.questions[i].items[j].image)
									if (await fs.pathExists(cheminImage)) {
										image = await fs.readFile(cheminImage)
									}
								} else if (stockage === 's3') {
									image = await lireFichierS3(code + '/' + donnees.questions[i].items[j].image)
								}
								if (image !== '' && magic.includes(image.toString('hex', 0, 4)) === true) {
									if (donnees.questions[i].items[j].reponse === true) {
										doc.font('Helvetica').fillColor('#00a695').text(alphabet[j] + '. (' + statistiques[i].pourcentages[j] + '% - ' + statistiques[i].personnes[j] + ') - ' + t[req.session.langue].bonneReponse).image(image, { fit: [75, 75] })
									} else {
										doc.font('Helvetica').fillColor('grey').text(alphabet[j] + '. (' + statistiques[i].pourcentages[j] + '% - ' + statistiques[i].personnes[j] + ')').image(image, { fit: [75, 75] })
									}
								} else if (donnees.questions[i].items[j].reponse === true) {
									doc.font('Helvetica').fillColor('#00a695').text(alphabet[j] + '. ' + donnees.questions[i].items[j].alt + ' (' + statistiques[i].pourcentages[j] + '% - ' + statistiques[i].personnes[j] + ') - ' + t[req.session.langue].bonneReponse)
								} else {
									doc.font('Helvetica').fillColor('grey').text(alphabet[j] + '. ' + donnees.questions[i].items[j].alt + ' (' + statistiques[i].pourcentages[j] + '% - ' + statistiques[i].personnes[j] + ')')
								}
							} else if (donnees.questions[i].items[j].hasOwnProperty('audio') && donnees.questions[i].items[j].audio !== '') {
								doc.fontSize(10)
								if (donnees.questions[i].items[j].reponse === true) {
									doc.font('Helvetica').fillColor('#00a695').text(alphabet[j] + '. ' + t[req.session.langue].fichierAudio + ' ' + donnees.questions[i].items[j].audio + ' (' + statistiques[i].pourcentages[j] + '% - ' + statistiques[i].personnes[j] + ') - ' + t[req.session.langue].bonneReponse)
								} else {
									doc.font('Helvetica').fillColor('grey').text(alphabet[j] + '. ' + t[req.session.langue].fichierAudio + ' ' + donnees.questions[i].items[j].audio + ' (' + statistiques[i].pourcentages[j] + '% - ' + statistiques[i].personnes[j] + ')')
								}
							}
							doc.moveDown()
						}
					} else {
						const itemsTexte = []
						reponses.forEach(function (donnees) {
							if (!bannis.includes(donnees.identifiant)) {
								donnees.reponse[i].forEach(function (reponse) {
									if (!itemsTexte.includes(reponse.toString().trim())) {
										itemsTexte.push(reponse.toString().trim())
									}
								})
							}
						})
						const reponsesTexte = donnees.questions[i].reponses.split('|')
						reponsesTexte.forEach(function (item, index) {
							reponsesTexte[index] = item.trim()
						})
						itemsTexte.forEach(async function (item, index) {
							doc.fontSize(10)
							if (reponsesTexte.includes(item) === true) {
								doc.font('Helvetica').fillColor('#00a695').text((index + 1) + '. ' + item + ' (' + statistiques[i].pourcentages[index] + '% - ' + statistiques[i].personnes[index] + ') - ' + t[req.session.langue].bonneReponse)
							} else {
								doc.font('Helvetica').fillColor('grey').text((index + 1) + '. ' + item + ' (' + statistiques[i].pourcentages[index] + '% - ' + statistiques[i].personnes[index] + ')')
							}
							doc.moveDown()
						})
					}
					doc.moveDown()
					doc.moveDown()
				}
				if (classement.length > 0 && donnees.hasOwnProperty('options') && donnees.options.nom === 'obligatoire') {
					doc.fontSize(14)
					doc.font('Helvetica-Bold').fillColor('black').text(t[req.session.langue].classement)
					doc.fontSize(10)
					doc.font('Helvetica').text('-----------------------------------------------')
					doc.fontSize(14)
					doc.moveDown()
					doc.fontSize(12)
					classement.forEach(function (utilisateur, indexUtilisateur) {
						doc.font('Helvetica').text((indexUtilisateur + 1) + '. ' + utilisateur.nom + ' (' + (Math.round(utilisateur.score * 10) / 10) + ' ' + t[req.session.langue].points + ')')
						doc.moveDown()
					})
				}
			} else if (type === 'Remue-méninges' && typeof donnees === 'object' && donnees !== null) {
				let categories = []
				if (donnees.hasOwnProperty('categories')) {
					categories = donnees.categories.filter(function (categorie) {
						return categorie.texte !== '' || categorie.image !== ''
					})
				}
				const messages = definirMessagesRemueMeninges(categories, reponses, bannis)
				if (dateDebut !== '' && dateFin !== '') {
					doc.fontSize(8)
					doc.font('Helvetica').text(formaterDate(dateDebut, t[req.session.langue].demarre, req.session.langue) + ' - ' + formaterDate(dateFin, t[req.session.langue].termine, req.session.langue))
					doc.moveDown()
				}
				doc.moveDown()
				doc.fontSize(12)
				doc.font('Helvetica-Bold').text(t[req.session.langue].question, { underline: true })
				doc.moveDown()
				doc.font('Helvetica-Bold').text(donnees.question)
				if (Object.keys(donnees.support).length > 0) {
					doc.fontSize(10)
					doc.moveDown()
					doc.moveDown()
					doc.fontSize(12)
					doc.font('Helvetica-Bold').text(t[req.session.langue].support, { underline: true })
					doc.fontSize(10)
					doc.moveDown()
					if (donnees.support.type === 'image' && donnees.support.fichier !== '') {
						let support = ''
						if (stockage === 'fs') {
							const cheminSupport = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + donnees.support.fichier)
							if (await fs.pathExists(cheminSupport)) {
								support = await fs.readFile(cheminSupport)
							}
						} else if (stockage === 's3') {
							support = await lireFichierS3(code + '/' + donnees.support.fichier)
						}
						if (support !== '' && magic.includes(support.toString('hex', 0, 4)) === true) {
							doc.image(support, { fit: [120, 120] })
							doc.moveDown()
						} else {
							doc.font('Helvetica').text(t[req.session.langue].image + ' ' + donnees.support.alt)
							doc.moveDown()
						}
					} else if (donnees.support.type === 'audio') {
						doc.font('Helvetica').text(t[req.session.langue].fichierAudio + ' ' + donnees.support.alt)
						doc.moveDown()
					} else if (donnees.support.type === 'video') {
						doc.font('Helvetica').text(t[req.session.langue].video, {
							link: donnees.support.lien,
							underline: true
						})
						doc.moveDown()
					}
				}
				doc.moveDown()
				doc.fontSize(12)
				// Messages visibles
				if (categories.length > 0) {
					let totalMessagesVisibles = 0
					messages.visibles.forEach(function (categorie) {
						totalMessagesVisibles = totalMessagesVisibles + categorie.length
					})
					doc.font('Helvetica-Bold').text(t[req.session.langue].reponses + ' (' + totalMessagesVisibles + ')', { underline: true })
					doc.moveDown()
					for (let i = 0; i < categories.length; i++) {
						if (categories[i].texte !== '') {
							doc.fontSize(10)
							doc.font('Helvetica-Bold').text((i + 1) + '. ' + categories[i].texte + ' (' + messages.visibles[i].length + ')')
							if (categories[i].image !== '') {
								let image = ''
								if (stockage === 'fs') {
									const cheminImage = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + categories[i].image)
									if (await fs.pathExists(cheminImage)) {
										image = await fs.readFile(cheminImage)
									}
								} else if (stockage === 's3') {
									image = await lireFichierS3(code + '/' + categories[i].image)
								}
								if (image !== '' && magic.includes(image.toString('hex', 0, 4)) === true) {
									doc.image(image, { fit: [40, 40] })
									doc.moveDown()
								} else {
									doc.fontSize(10)
									doc.font('Helvetica').text(categories[i].alt)
									doc.moveDown()
								}
							}
							messages.visibles[i].forEach(function (message) {
								doc.fontSize(9)
								doc.font('Helvetica').text('• ' + message.reponse.texte)
							})
						} else if (categories[i].image !== '') {
							doc.fontSize(10)
							let image = ''
							if (stockage === 'fs') {
								const cheminImage = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + categories[i].image)
								if (await fs.pathExists(cheminImage)) {
									image = await fs.readFile(cheminImage)
								}
							} else if (stockage === 's3') {
								image = await lireFichierS3(code + '/' + categories[i].image)
							}
							if (image !== '' && magic.includes(image.toString('hex', 0, 4)) === true) {
								doc.font('Helvetica-Bold').text((i + 1) + '. (' + messages.visibles[i].length + ')').image(image, { fit: [40, 40] })
								doc.moveDown()
							} else {
								doc.font('Helvetica-Bold').text((index + 1) + '. ' + categories[i].alt + ' (' + messages.visibles[i].length + ')')
							}
							messages.visibles[i].forEach(function (message) {
								doc.fontSize(9)
								doc.font('Helvetica').text('• ' + message.reponse.texte)
							})
						}
						doc.moveDown()
					}
				} else {
					doc.font('Helvetica-Bold').text(t[req.session.langue].reponses + ' (' + messages.visibles.length + ')', { underline: true })
					doc.moveDown()
					messages.visibles.forEach(function (message) {
						doc.fontSize(9)
						doc.font('Helvetica').text('• ' + message.reponse.texte)
					})
				}
				// Messages supprimés
				if (messages.supprimes.length > 0) {
					doc.moveDown()
					doc.fontSize(12)
					if (categories.length > 0) {
						let totalMessagesSupprimes = 0
						messages.supprimes.forEach(function (categorie) {
							totalMessagesSupprimes = totalMessagesSupprimes + categorie.length
						})
						doc.font('Helvetica-Bold').text(t[req.session.langue].messagesSupprimes + ' (' + totalMessagesSupprimes + ')', { underline: true })
						doc.moveDown()
						for (let i = 0; i < categories.length; i++) {
							if (categories[i].texte !== '') {
								doc.fontSize(10)
								doc.font('Helvetica-Bold').text((i + 1) + '. ' + categories[i].texte + ' (' + messages.supprimes[i].length + ')')
								if (categories[i].image !== '') {
									let image = ''
									if (stockage === 'fs') {
										const cheminImage = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + categories[i].image)
										if (await fs.pathExists(cheminImage)) {
											image = await fs.readFile(cheminImage)
										}
									} else if (stockage === 's3') {
										image = await lireFichierS3(code + '/' + categories[i].image)
									}
									if (image !== '' && magic.includes(image.toString('hex', 0, 4)) === true) {
										doc.image(image, { fit: [40, 40] })
										doc.moveDown()
									} else {
										doc.fontSize(10)
										doc.font('Helvetica').text(categories[i].alt)
										doc.moveDown()
									}
								}
								messages.supprimes[i].forEach(function (message) {
									doc.fontSize(9)
									doc.font('Helvetica').text('• ' + message.reponse.texte)
								})
							} else if (categories[i].image !== '') {
								doc.fontSize(10)
								let image = ''
								if (stockage === 'fs') {
									const cheminImage = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + categories[i].image)
									if (await fs.pathExists(cheminImage)) {
										image = await fs.readFile(cheminImage)
									}
								} else if (stockage === 's3') {
									image = await lireFichierS3(code + '/' + categories[i].image)
								}
								if (image !== '' && magic.includes(image.toString('hex', 0, 4)) === true) {
									doc.font('Helvetica-Bold').text((i + 1) + '. (' + messages.supprimes[i].length + ')').image(image, { fit: [40, 40] })
									doc.moveDown()
								} else {
									doc.font('Helvetica-Bold').text((index + 1) + '. ' + categories[i].alt + ' (' + messages.supprimes[i].length + ')')
									doc.moveDown()
								}
								messages.supprimes[i].forEach(function (message) {
									doc.fontSize(9)
									doc.font('Helvetica').text('• ' + message.reponse.texte)
								})
							}
							doc.moveDown()
						}
					} else {
						doc.font('Helvetica-Bold').text(t[req.session.langue].messagesSupprimes + ' (' + messages.supprimes.length + ')', { underline: true })
						doc.moveDown()
						messages.supprimes.forEach(function (message) {
							doc.fontSize(9)
							doc.font('Helvetica').text('• ' + message.reponse.texte)
						})
					}
				}
			} else if (type === 'Nuage-de-mots' && typeof donnees === 'object' && donnees !== null) {
				const mots = definirMotsNuageDeMots(reponses, bannis)
				if (dateDebut !== '' && dateFin !== '') {
					doc.fontSize(8)
					doc.font('Helvetica').text(formaterDate(dateDebut, t[req.session.langue].demarre, req.session.langue) + ' - ' + formaterDate(dateFin, t[req.session.langue].termine, req.session.langue))
					doc.moveDown()
				}
				doc.moveDown()
				doc.fontSize(12)
				doc.font('Helvetica-Bold').text(t[req.session.langue].question, { underline: true })
				doc.moveDown()
				doc.font('Helvetica-Bold').text(donnees.question)
				if (Object.keys(donnees.support).length > 0) {
					doc.fontSize(10)
					doc.moveDown()
					doc.moveDown()
					doc.fontSize(12)
					doc.font('Helvetica-Bold').text(t[req.session.langue].support, { underline: true })
					doc.fontSize(10)
					doc.moveDown()
					if (donnees.support.type === 'image' && donnees.support.fichier !== '') {
						let support = ''
						if (stockage === 'fs') {
							const cheminSupport = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + donnees.support.fichier)
							if (await fs.pathExists(cheminSupport)) {
								support = await fs.readFile(cheminSupport)
							}
						} else if (stockage === 's3') {
							support = await lireFichierS3(code + '/' + donnees.support.fichier)
						}
						if (support !== '' && magic.includes(support.toString('hex', 0, 4)) === true) {
							doc.image(support, { fit: [120, 120] })
							doc.moveDown()
						} else {
							doc.font('Helvetica').text(t[req.session.langue].image + ' ' + donnees.support.alt)
							doc.moveDown()
						}
					} else if (donnees.support.type === 'audio') {
						doc.font('Helvetica').text(t[req.session.langue].fichierAudio + ' ' + donnees.support.alt)
						doc.moveDown()
					} else if (donnees.support.type === 'video') {
						doc.font('Helvetica').text(t[req.session.langue].video, {
							link: donnees.support.lien,
							underline: true
						})
						doc.moveDown()
					}
				}
				doc.moveDown()
				doc.fontSize(12)
				doc.font('Helvetica-Bold').text(t[req.session.langue].reponses + ' (' + mots.visibles.length + ')', { underline: true })
				doc.moveDown()
				mots.visibles.forEach(function (mot) {
					doc.fontSize(9)
					doc.font('Helvetica').text('• ' + mot.reponse.texte)
				})
				if (mots.supprimes.length > 0) {
					doc.moveDown()
					doc.fontSize(12)
					doc.font('Helvetica-Bold').text(t[req.session.langue].motsSupprimes + ' (' + mots.supprimes.length + ')', { underline: true })
					doc.moveDown()
					mots.supprimes.forEach(function (mot) {
						doc.fontSize(9)
						doc.font('Helvetica').text('• ' + mot.reponse.texte)
					})
				}
			}
			doc.end()
		} else {
			res.send('non_autorise')
		}
	})

	app.post('/api/supprimer-resultat', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant) {
			const code = parseInt(req.body.code)
			const session = parseInt(req.body.session)
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { res.send('erreur'); return false }
			if (reponse === 1) {
				let donnees = await db.HGETALL('interactions:' + code)
				donnees = Object.assign({}, donnees)
				if (donnees === null) { res.send('erreur'); return false }
				if (await verifierAdmin(code, donnees.identifiant, req.session) === false) {
					res.send('non_autorise')
					return false
				}
				const reponses = JSON.parse(donnees.reponses)
				const sessions = JSON.parse(donnees.sessions)
				if (reponses[session]) {
					delete reponses[session]
				}
				if (sessions[session]) {
					delete sessions[session]
				}
				await db.HSET('interactions:' + code, ['reponses', JSON.stringify(reponses), 'sessions', JSON.stringify(sessions)])
				res.json({ reponses: reponses, sessions: sessions })
			} else {
				res.send('erreur_code')
			}
		} else {
			res.send('non_autorise')
		}
	})

	app.post('/api/ajouter-dossier', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			let donneesUtilisateur = await db.HGETALL('utilisateurs:' + identifiant)
			donneesUtilisateur = Object.assign({}, donneesUtilisateur)
			if (donneesUtilisateur === null || !donneesUtilisateur.hasOwnProperty('motdepasse')) { res.send('erreur'); return false }
			if (await bcrypt.compare(req.session.motdepasse, donneesUtilisateur.motdepasse)) {
				const nom = req.body.dossier
				let dossiers = []
				if (donneesUtilisateur.hasOwnProperty('dossiers')) {
					dossiers = JSON.parse(donneesUtilisateur.dossiers)
				}
				const id = Math.random().toString(36).substring(2)
				dossiers.push({ id: id, nom: nom, contenus: [] })
				await db.HSET('utilisateurs:' + identifiant, 'dossiers', JSON.stringify(dossiers))
				res.json({ id: id, nom: nom, contenus: [] })
			} else {
				res.send('non_autorise')
			}
		} else {
			res.send('non_connecte')
		}
	})

	app.post('/api/modifier-dossier', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			let donneesUtilisateur = await db.HGETALL('utilisateurs:' + identifiant)
			donneesUtilisateur = Object.assign({}, donneesUtilisateur)
			if (donneesUtilisateur === null || !donneesUtilisateur.hasOwnProperty('motdepasse')) { res.send('erreur'); return false }
			if (await bcrypt.compare(req.session.motdepasse, donneesUtilisateur.motdepasse)) {
				const nom = req.body.dossier
				const dossierId = req.body.dossierId
				const dossiers = JSON.parse(donneesUtilisateur.dossiers)
				dossiers.forEach(function (dossier, index) {
					if (dossier.id === dossierId) {
						dossiers[index].nom = nom
					}
				})
				await db.HSET('utilisateurs:' + identifiant, 'dossiers', JSON.stringify(dossiers))
				res.send('dossier_modifie')
			} else {
				res.send('non_autorise')
			}
		} else {
			res.send('non_connecte')
		}
	})

	app.post('/api/supprimer-dossier', async function (req, res) {
		const identifiant = req.body.identifiant
		if (req.session.identifiant && req.session.identifiant === identifiant && req.session.role === 'utilisateur' && req.session.hasOwnProperty('motdepasse') && req.session.motdepasse !== '') {
			let donneesUtilisateur = await db.HGETALL('utilisateurs:' + identifiant)
			donneesUtilisateur = Object.assign({}, donneesUtilisateur)
			if (donneesUtilisateur === null || !donneesUtilisateur.hasOwnProperty('motdepasse')) { res.send('erreur'); return false }
			if (await bcrypt.compare(req.session.motdepasse, donneesUtilisateur.motdepasse)) {
				const dossierId = req.body.dossierId
				const dossiers = JSON.parse(donneesUtilisateur.dossiers)
				dossiers.forEach(function (dossier, index) {
					if (dossier.id === dossierId) {
						dossiers.splice(index, 1)
					}
				})
				await db.HSET('utilisateurs:' + identifiant, 'dossiers', JSON.stringify(dossiers))
				res.send('dossier_supprime')
			} else {
				res.send('non_autorise')
			}
		} else {
			res.send('non_connecte')
		}
	})

	app.post('/api/televerser-image', function (req, res) {
		const identifiant = req.session.identifiant
		if (!identifiant) {
			res.send('non_autorise')
		} else if (stockage === 's3') {
			const buffers = []
			let nom
			const formData = new Map()
			const busboy = Busboy({ headers: req.headers })
			busboy.on('field', function (champ, valeur) {
				formData.set(champ, valeur)
			})
			busboy.on('file', async function (champ, fichier, meta) {
				nom = definirNomFichier(meta.filename)
				fichier.on('data', function (donnees) {
					buffers.push(donnees)
				})
			})
			busboy.on('finish', async function () {
				const bufferFichier = Buffer.concat(buffers)
				if (bufferFichier !== null && nom !== null) {
					const code = formData.get('code')
					const alt = path.parse(formData.get('nomfichier')).name
					const extension = path.parse(nom).ext
					if (extension.toLowerCase() === '.jpg' || extension.toLowerCase() === '.jpeg') {
						try {
							const buffer = await sharp(bufferFichier, { failOnError: false }).withMetadata().rotate().jpeg().resize(1000, 1000, {
								fit: sharp.fit.inside,
								withoutEnlargement: true
							}).toBuffer()
							if (buffer !== null) {
								await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: code + '/' + nom, Body: buffer, ACL: 'public-read' }))
								res.json({ image: nom, alt: alt })
							} else {
								res.send('erreur')
							}
						} catch (e) {
							res.send('erreur')
						}
					} else {
						try {
							const buffer = await sharp(bufferFichier, { failOnError: false }).withMetadata().resize(1000, 1000, {
								fit: sharp.fit.inside,
								withoutEnlargement: true
							}).toBuffer()
							if (buffer !== null) {
								await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: code + '/' + nom, Body: buffer, ACL: 'public-read' }))
								res.json({ image: nom, alt: alt })
							} else {
								res.send('erreur')
							}
						} catch (e) {
							res.send('erreur')
						}
					}
				} else {
					res.send('erreur')
				}
			})
			req.pipe(busboy)
		} else {
			televerser(req, res, async function (err) {
				if (err) { res.send('erreur'); return false }
				const fichier = req.file
				if (fichier.hasOwnProperty('filename')) {
					const code = req.body.code
					const alt = path.parse(req.body.nomfichier).name
					const chemin = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + fichier.filename)
					const extension = path.parse(fichier.filename).ext
					if (extension.toLowerCase() === '.jpg' || extension.toLowerCase() === '.jpeg') {
						try {
							const buffer = await sharp(chemin, { failOnError: false }).withMetadata().rotate().jpeg().resize(1000, 1000, {
								fit: sharp.fit.inside,
								withoutEnlargement: true
							}).toBuffer()
							if (buffer !== null) {
								await fs.writeFile(chemin, buffer)
								res.json({ image: fichier.filename, alt: alt })
							}  else {
								res.send('erreur')
							}
						} catch (e) {
							res.send('erreur')
						}
					} else {
						try {
							const buffer = await sharp(chemin, { failOnError: false }).withMetadata().resize(1000, 1000, {
								fit: sharp.fit.inside,
								withoutEnlargement: true
							}).toBuffer()
							if (buffer !== null) {
								await fs.writeFile(chemin, buffer)
								res.json({ image: fichier.filename, alt: alt })
							} else {
								res.send('erreur')
							}
						} catch (e) {
							res.send('erreur')
						}
					}
				} else {
					res.send('erreur')
				}
			})
		}
	})

	app.post('/api/dupliquer-medias', function (req, res) {
		const code = req.body.code
		const medias = req.body.medias
		medias.forEach(async function (media) {
			if (stockage === 'fs' && media !== '' && await fs.pathExists(path.join(__dirname, '..', '/static/fichiers/' + code + '/' + media))) {
				await fs.copy(path.join(__dirname, '..', '/static/fichiers/' + code + '/' + media), path.join(__dirname, '..', '/static/fichiers/' + code + '/dup-' + media))
			} else if (stockage === 's3' && media !== '') {
				await s3Client.send(new CopyObjectCommand({ Bucket: bucket, Key: code + '/dup-' + media, CopySource: '/' + bucket + '/' + code + '/' + media, ACL: 'public-read' }))
			}
		})
		res.send('medias_dupliques')
	})

	app.post('/api/televerser-media', function (req, res) {
		const identifiant = req.session.identifiant
		if (!identifiant) {
			res.send('non_autorise')
		} else if (stockage === 's3') {
			const buffers = []
			let nom
			let info
			const formData = new Map()
			const busboy = Busboy({ headers: req.headers })
			busboy.on('field', function (champ, valeur) {
				formData.set(champ, valeur)
			})
			busboy.on('file', async function (champ, fichier, meta) {
				nom = definirNomFichier(meta.filename)
				info = path.parse(meta.filename)
				fichier.on('data', function (donnees) {
					buffers.push(donnees)
				})
			})
			busboy.on('finish', async function () {
				const bufferFichier = Buffer.concat(buffers)
				if (bufferFichier !== null && nom !== null && info !== null) {
					const extension = info.ext.toLowerCase()
					const code = formData.get('code')
					const alt = path.parse(formData.get('nomfichier')).name
					if (extension.toLowerCase() === '.jpg' || extension.toLowerCase() === '.jpeg') {
						try {
							const buffer = await sharp(bufferFichier, { failOnError: false }).withMetadata().rotate().jpeg().resize(1000, 1000, {
								fit: sharp.fit.inside,
								withoutEnlargement: true
							}).toBuffer()
							if (buffer !== null) {
								await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: code + '/' + nom, Body: buffer, ACL: 'public-read' }))
								res.json({ fichier: nom, alt: alt, type: 'image' })
							} else {
								res.send('erreur')
							}
						} catch (e) {
							res.send('erreur')
						}
					} else if (extension === '.png' || extension === '.gif') {
						try {
							const buffer = await sharp(bufferFichier, { failOnError: false }).withMetadata().resize(1000, 1000, {
								fit: sharp.fit.inside,
								withoutEnlargement: true
							}).toBuffer()
							if (buffer !== null) {
								await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: code + '/' + nom, Body: buffer, ACL: 'public-read' }))
								res.json({ fichier: nom, alt: alt, type: 'image' })
							} else {
								res.send('erreur')
							}
						} catch (e) {
							res.send('erreur')
						}
					} else if (bufferFichier !== null) {
						await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: code + '/' + nom, Body: bufferFichier, ACL: 'public-read' }))
						res.json({ fichier: nom, alt: alt, type: 'audio' })
					} else {
						res.send('erreur')
					}
				} else {
					res.send('erreur')
				}
			})
			req.pipe(busboy)
		} else {
			televerser(req, res, async function (err) {
				if (err) { res.send('erreur'); return false }
				const fichier = req.file
				if (fichier.hasOwnProperty('filename') && fichier.hasOwnProperty('originalname')) {
					const info = path.parse(fichier.originalname)
					const alt = path.parse(req.body.nomfichier).name
					const extension = info.ext.toLowerCase()
					const code = req.body.code
					const chemin = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + fichier.filename)
					if (extension === '.jpg' || extension === '.jpeg') {
						try {
							const buffer = await sharp(chemin, { failOnError: false }).withMetadata().rotate().jpeg().resize(1000, 1000, {
								fit: sharp.fit.inside,
								withoutEnlargement: true
							}).toBuffer()
							if (buffer !== null) {
								await fs.writeFile(chemin, buffer)
								res.json({ fichier: fichier.filename, alt: alt, type: 'image' })
							} else {
								res.send('erreur')
							}
						} catch (e) {
							res.send('erreur')
						}
					} else if (extension === '.png' || extension === '.gif') {
						try {
							const buffer = await sharp(chemin, { failOnError: false }).withMetadata().resize(1000, 1000, {
								fit: sharp.fit.inside,
								withoutEnlargement: true
							}).toBuffer()
							if (buffer !== null) {
								await fs.writeFile(chemin, buffer)
								res.json({ fichier: fichier.filename, alt: alt, type: 'image' })
							} else {
								res.send('erreur')
							}
						} catch (e) {
							res.send('erreur')
						}
					} else {
						res.json({ fichier: fichier.filename, alt: alt, type: 'audio' })
					}
				} else {
					res.send('erreur')
				}
			})
		}
	})

	app.post('/api/supprimer-fichiers', function (req, res) {
		const code = req.body.code
		const fichiers = req.body.fichiers
		fichiers.forEach(function (fichier) {
			supprimerFichier(code, fichier)
		})
		res.send('fichiers_supprimes')
	})

	app.post('/api/ladigitale', function (req, res) {
		const tokenApi = req.body.token
		const domaine = req.headers.host
		const lien = req.body.lien
		const params = new URLSearchParams()
		params.append('token', tokenApi)
		params.append('domaine', domaine)
		axios.post(lien, params).then(async function (reponse) {
			if (reponse.data === 'non_autorise' || reponse.data === 'erreur') {
				res.send('erreur_token')
			} else if (reponse.data === 'token_autorise' && req.body.action && req.body.action === 'creer') {
				const titre = req.body.nom
				const type = req.body.interaction
				const code = Math.floor(1000000 + Math.random() * 9000000)
				const motdepasse = req.body.motdepasse
				const date = dayjs().format()
				const reponse = await db.EXISTS('interactions:' + code)
				if (reponse === null) { res.send('erreur'); return false }
				if (reponse === 0) {
					await db.HSET('interactions:' + code, ['type', type, 'titre', titre, 'code', code, 'motdepasse', motdepasse, 'donnees', JSON.stringify({}), 'reponses', JSON.stringify({}), 'sessions', JSON.stringify({}), 'statut', '', 'session', 1, 'date', date, 'digidrive', 1])
					if (stockage === 'fs') {
						const chemin = path.join(__dirname, '..', '/static/fichiers/' + code)
						await fs.mkdirp(chemin)
					}
					res.send(code.toString())
				} else {
					res.send('erreur')
				}
			} else if (reponse.data === 'token_autorise' && req.body.action && req.body.action === 'modifier-titre') {
				const code = req.body.id
				const titre = req.body.titre
				const reponse = await db.EXISTS('interactions:' + code)
				if (reponse === null) { res.send('erreur'); return false }
				if (reponse === 1) {
					await db.HSET('interactions:' + code, 'titre', titre)
					res.send('titre_modifie')
				} else {
					res.send('contenu_inexistant')
				}
			} else if (reponse.data === 'token_autorise' && req.body.action && req.body.action === 'modifier') {
				const code = req.body.id
				const titre = req.body.titre
				const ancienmotdepasse = req.body.ancienmotdepasse
				const reponse = await db.EXISTS('interactions:' + code)
				if (reponse === null) { res.send('erreur'); return false }
				if (reponse === 1) {
					let donnees = await db.HGETALL('interactions:' + code)
					donnees = Object.assign({}, donnees)
					if (donnees === null) { res.send('erreur'); return false }
					if (donnees.hasOwnProperty('motdepasse') && ancienmotdepasse === donnees.motdepasse) {
						const motdepasse = req.body.motdepasse
						await db.HSET('interactions:' + code, ['titre', titre, 'motdepasse', motdepasse])
						res.send('contenu_modifie')
					} else {
						res.send('non_autorise')
					}
				} else {
					res.send('contenu_inexistant')
				}
			} else if (reponse.data === 'token_autorise' && req.body.action && req.body.action === 'ajouter') {
				const identifiant = req.body.identifiant
				const motdepasse = req.body.motdepasse
				const code = parseInt(req.body.id)
				const reponse = await db.EXISTS('interactions:' + code)
				if (reponse === null) { res.send('erreur'); return false }
				if (reponse === 1) {
					let donnees = await db.HGETALL('interactions:' + code)
					donnees = Object.assign({}, donnees)
					if (donnees === null) { res.send('erreur'); return false }
					if (donnees.hasOwnProperty('motdepasse') && motdepasse === donnees.motdepasse) {
						res.json({ titre: donnees.titre, identifiant: identifiant })
					} else if (donnees.hasOwnProperty('motdepasse') && donnees.motdepasse === '') {
						const resultat = await db.EXISTS('utilisateurs:' + donnees.identifiant)
						if (resultat === null) { res.send('erreur'); return false }
						if (resultat === 1) {
							let utilisateur = await db.HGETALL('utilisateurs:' + donnees.identifiant)
							utilisateur = Object.assign({}, utilisateur)
							if (utilisateur === null) { res.send('erreur'); return false }
							if (motdepasse.trim() !== '' && utilisateur.hasOwnProperty('motdepasse') && utilisateur.motdepasse.trim() !== '' && await bcrypt.compare(motdepasse, utilisateur.motdepasse)) {
								await db.HSET('interactions:' + code, 'digidrive', 1)
								res.json({ titre: donnees.titre, identifiant: donnees.identifiant })
							} else {
								res.send('non_autorise')
							}
						} else {
							res.send('erreur')
						}
					} else {
						res.send('non_autorise')
					}
				} else {
					res.send('contenu_inexistant')
				}
			} else if (reponse.data === 'token_autorise' && req.body.action && req.body.action === 'dupliquer') {
				const identifiant = req.body.identifiant
				const motdepasse = req.body.motdepasse
				const interaction = parseInt(req.body.id)
				const reponse = await db.EXISTS('interactions:' + interaction)
				if (reponse === null) { res.send('erreur'); return false }
				if (reponse === 1) {
					let parametres = await db.HGETALL('interactions:' + interaction)
					parametres = Object.assign({}, parametres)
					if (parametres === null) { res.send('erreur'); return false }
					if (parametres.hasOwnProperty('motdepasse') && motdepasse === parametres.motdepasse) {
						const code = Math.floor(1000000 + Math.random() * 9000000)
						const nouveaumotdepasse = req.body.nouveaumotdepasse
						const date = dayjs().format()
						let resultat = await db.EXISTS('interactions:' + code)
						if (resultat === null) { res.send('erreur'); return false }
						if (resultat === 0) {
							await db.HSET('interactions:' + code, ['type', parametres.type, 'titre', 'Copie de ' + parametres.titre, 'code', code, 'motdepasse', nouveaumotdepasse, 'donnees', parametres.donnees, 'reponses', JSON.stringify({}), 'sessions', JSON.stringify({}), 'statut', '', 'session', 1, 'date', date, 'digidrive', 1])
							if (stockage === 'fs' && await fs.pathExists(path.join(__dirname, '..', '/static/fichiers/' + interaction))) {
								await fs.copy(path.join(__dirname, '..', '/static/fichiers/' + interaction), path.join(__dirname, '..', '/static/fichiers/' + code))
							} else if (stockage === 's3') {
								const liste = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: interaction + '/' }))
								if (liste !== null && liste.hasOwnProperty('Contents') && liste.Contents instanceof Array) {
									for (let i = 0; i < liste.Contents.length; i++) {
										await s3Client.send(new CopyObjectCommand({ Bucket: bucket, Key: code + '/' + liste.Contents[i].Key.replace(interaction + '/', ''), CopySource: '/' + bucket + '/' + liste.Contents[i].Key, ACL: 'public-read' }))
									}
								}
							}
							res.send(code.toString())
						} else {
							res.send('erreur')
						}
					} else if (parametres.hasOwnProperty('motdepasse') && parametres.motdepasse === '') {
						const resultat = await db.EXISTS('utilisateurs:' + identifiant)
						if (resultat === null) { res.send('erreur'); return false }
						if (resultat === 1) {
							let utilisateur = await db.HGETALL('utilisateurs:' + identifiant)
							utilisateur = Object.assign({}, utilisateur)
							if (utilisateur === null) { res.send('erreur'); return false }
							if (motdepasse.trim() !== '' && utilisateur.hasOwnProperty('motdepasse') && utilisateur.motdepasse.trim() !== '' && await bcrypt.compare(motdepasse, utilisateur.motdepasse)) {
								const code = Math.floor(1000000 + Math.random() * 9000000)
								const date = dayjs().format()
								let resultat = await db.EXISTS('interactions:' + code)
								if (resultat === null) { res.send('erreur'); return false }
								if (resultat === 0) {
									await db
									.multi()
									.HSET('interactions:' + code, ['type', parametres.type, 'titre', 'Copie de ' + parametres.titre, 'code', code, 'identifiant', identifiant, 'motdepasse', '', 'donnees', parametres.donnees, 'reponses', JSON.stringify({}), 'sessions', JSON.stringify({}), 'statut', '', 'session', 1, 'date', date, 'digidrive', 1])
									.SADD('interactions-creees:' + identifiant, code.toString())
									.exec()
									if (stockage === 'fs' && await fs.pathExists(path.join(__dirname, '..', '/static/fichiers/' + interaction))) {
										await fs.copy(path.join(__dirname, '..', '/static/fichiers/' + interaction), path.join(__dirname, '..', '/static/fichiers/' + code))
									} else if (stockage === 's3') {
										const liste = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: interaction + '/' }))
										if (liste !== null && liste.hasOwnProperty('Contents') && liste.Contents instanceof Array) {
											for (let i = 0; i < liste.Contents.length; i++) {
												await s3Client.send(new CopyObjectCommand({ Bucket: bucket, Key: code + '/' + liste.Contents[i].Key.replace(interaction + '/', ''), CopySource: '/' + bucket + '/' + liste.Contents[i].Key, ACL: 'public-read' }))
											}
										}
									}
									res.send(code.toString())
								} else {
									res.send('erreur')
								}
							} else {
								res.send('non_autorise')
							}
						} else {
							res.send('erreur')
						}
					} else {
						res.send('non_autorise')
					}
				} else {
					res.send('contenu_inexistant')
				}
			} else if (reponse.data === 'token_autorise' && req.body.action && req.body.action === 'exporter') {
				const identifiant = req.body.identifiant
				const motdepasse = req.body.motdepasse
				const code = parseInt(req.body.id)
				const reponse = await db.EXISTS('interactions:' + code)
				if (reponse === null) { res.send('erreur'); return false }
				if (reponse === 1) {
					let parametres = await db.HGETALL('interactions:' + code)
					parametres = Object.assign({}, parametres)
					if (parametres === null) { res.send('erreur'); return false }
					if (parametres.hasOwnProperty('motdepasse') && parametres.motdepasse === motdepasse) {
						const chemin = path.join(__dirname, '..', '/static/temp')
						await fs.mkdirp(path.normalize(chemin + '/' + code))
						await fs.mkdirp(path.normalize(chemin + '/' + code + '/fichiers'))
						await fs.writeFile(path.normalize(chemin + '/' + code + '/donnees.json'), JSON.stringify(parametres, '', 4), 'utf8')
						const donnees = JSON.parse(parametres.donnees)
						if (Object.keys(donnees).length > 0) {
							const fichiers = definirListeFichiers(parametres.type, donnees)
							for (const fichier of fichiers) {
								if (stockage === 'fs' && fichier !== '' && await fs.pathExists(path.join(__dirname, '..', '/static/fichiers/' + code + '/' + fichier))) {
									await fs.copy(path.join(__dirname, '..', '/static/fichiers/' + code + '/' + fichier), path.normalize(chemin + '/' + code + '/fichiers/' + fichier, { overwrite: true }))
								} else if (stockage === 's3' && fichier !== '') {
									try {
										const fichierMeta = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: code + '/' + fichier }))
										if (fichierMeta.hasOwnProperty('ContentLength')) {
											await telechargerFichierS3(code + '/' + fichier, path.normalize(chemin + '/' + code + '/fichiers/' + fichier))
										}
									} catch (e) {}
								}
							}
							const archiveId = Math.floor((Math.random() * 100000) + 1)
							const sortie = fs.createWriteStream(path.normalize(chemin + '/' + code + '_' + archiveId + '.zip'))
							const archive = archiver('zip', {
								zlib: { level: 9 }
							})
							sortie.on('finish', async function () {
								await fs.remove(path.normalize(chemin + '/' + code))
								res.send(code + '_' + archiveId + '.zip')
							})
							archive.pipe(sortie)
							archive.directory(path.normalize(chemin + '/' + code), false)
							archive.finalize()
						} else {
							res.send('erreur')
						}
					} else if (parametres.hasOwnProperty('motdepasse') && parametres.motdepasse === '') {
						const resultat = await db.EXISTS('utilisateurs:' + identifiant)
						if (resultat === null) { res.send('erreur'); return false }
						if (resultat === 1) {
							let utilisateur = await db.HGETALL('utilisateurs:' + identifiant)
							utilisateur = Object.assign({}, utilisateur)
							if (utilisateur === null) { res.send('erreur'); return false }
							if (motdepasse.trim() !== '' && utilisateur.hasOwnProperty('motdepasse') && utilisateur.motdepasse.trim() !== '' && await bcrypt.compare(motdepasse, utilisateur.motdepasse)) {
								const chemin = path.join(__dirname, '..', '/static/temp')
								await fs.mkdirp(path.normalize(chemin + '/' + code))
								await fs.mkdirp(path.normalize(chemin + '/' + code + '/fichiers'))
								await fs.writeFile(path.normalize(chemin + '/' + code + '/donnees.json'), JSON.stringify(parametres, '', 4), 'utf8')
								const donnees = JSON.parse(parametres.donnees)
								if (Object.keys(donnees).length > 0) {
									const fichiers = definirListeFichiers(parametres.type, donnees)
									for (const fichier of fichiers) {
										if (stockage === 'fs' && fichier !== '' && await fs.pathExists(path.join(__dirname, '..', '/static/fichiers/' + code + '/' + fichier))) {
											await fs.copy(path.join(__dirname, '..', '/static/fichiers/' + code + '/' + fichier), path.normalize(chemin + '/' + code + '/fichiers/' + fichier, { overwrite: true }))
										} else if (stockage === 's3' && fichier !== '') {
											try {
												const fichierMeta = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: code + '/' + fichier }))
												if (fichierMeta.hasOwnProperty('ContentLength')) {
													await telechargerFichierS3(code + '/' + fichier, path.normalize(chemin + '/' + code + '/fichiers/' + fichier))
												}
											} catch (e) {}
										}
									}
									const archiveId = Math.floor((Math.random() * 100000) + 1)
									const sortie = fs.createWriteStream(path.normalize(chemin + '/' + code + '_' + archiveId + '.zip'))
									const archive = archiver('zip', {
										zlib: { level: 9 }
									})
									sortie.on('finish', async function () {
										await fs.remove(path.normalize(chemin + '/' + code))
										res.send(code + '_' + archiveId + '.zip')
									})
									archive.pipe(sortie)
									archive.directory(path.normalize(chemin + '/' + code), false)
									archive.finalize()
								} else {
									res.send('erreur')
								}
							} else {
								res.send('non_autorise')
							}
						} else {
							res.send('erreur')
						}
					} else {
						res.send('non_autorise')
					}
				} else {
					res.send('contenu_inexistant')
				}
			} else if (reponse.data === 'token_autorise' && req.body.action && req.body.action === 'supprimer') {
				const identifiant = req.body.identifiant
				const motdepasse = req.body.motdepasse
				const code = parseInt(req.body.id)
				const reponse = await db.EXISTS('interactions:' + code)
				if (reponse === null) { res.send('erreur'); return false }
				if (reponse === 1) {
					let donnees = await db.HGETALL('interactions:' + code)
					donnees = Object.assign({}, donnees)
					if (donnees === null) { res.send('erreur'); return false }
					if (donnees.hasOwnProperty('motdepasse') && motdepasse === donnees.motdepasse) {
						await db.UNLINK('interactions:' + code)
						if (stockage === 'fs') {
							await fs.remove(path.join(__dirname, '..', '/static/fichiers/' + code))
						} else if (stockage === 's3') {
							const liste = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: code + '/' }))
							if (liste !== null && liste.hasOwnProperty('Contents') && liste.Contents instanceof Array) {
								for (let i = 0; i < liste.Contents.length; i++) {
									await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: liste.Contents[i].Key }))
								}
							}
						}
						res.send('contenu_supprime')
					} else if (donnees.hasOwnProperty('motdepasse') && donnees.motdepasse === '') {
						const resultat = await db.EXISTS('utilisateurs:' + identifiant)
						if (resultat === null) { res.send('erreur'); return false }
						if (resultat === 1) {
							let utilisateur = await db.HGETALL('utilisateurs:' + identifiant)
							utilisateur = Object.assign({}, utilisateur)
							if (utilisateur === null) { res.send('erreur'); return false }
							if (motdepasse.trim() !== '' && utilisateur.hasOwnProperty('motdepasse') && utilisateur.motdepasse.trim() !== '' && await bcrypt.compare(motdepasse, utilisateur.motdepasse)) {
								await db
								.multi()
								.UNLINK('interactions:' + code)
								.SREM('interactions-creees:' + identifiant, code.toString())
								.exec()
								if (stockage === 'fs') {
									await fs.remove(path.join(__dirname, '..', '/static/fichiers/' + code))
								} else if (stockage === 's3') {
									const liste = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: code + '/' }))
									if (liste !== null && liste.hasOwnProperty('Contents') && liste.Contents instanceof Array) {
										for (let i = 0; i < liste.Contents.length; i++) {
											await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: liste.Contents[i].Key }))
										}
									}
								}
								res.send('contenu_supprime')
							} else {
								res.send('non_autorise')
							}
						} else {
							res.send('erreur')
						}
					} else {
						res.send('non_autorise')
					}
				} else {
					res.send('contenu_supprime')
				}
			} else {
				res.send('erreur')
			}
		}).catch(function () {
			res.send('erreur')
		})
	})

	app.post('/api/ladigitale/importer', function (req, res) {
		televerserArchive(req, res, async function (err) {
			if (err) { res.send('erreur'); return false }
			try {
				const tokenApi = req.body.token
				const domaine = req.headers.host
				const lien = req.body.lien
				const params = new URLSearchParams()
				params.append('token', tokenApi)
				params.append('domaine', domaine)
				axios.post(lien, params).then(async function (reponse) {
					if (reponse.data === 'non_autorise' || reponse.data === 'erreur') {
						res.send('erreur_token')
					} else if (reponse.data === 'token_autorise' && req.body.action && req.body.action === 'importer') {
						const titre = req.body.titre
						const motdepasse = req.body.motdepasse
						const source = path.join(__dirname, '..', '/static/temp/' + req.file.filename)
						const cible = path.join(__dirname, '..', '/static/temp/archive-' + Math.floor((Math.random() * 100000) + 1))
						await extract(source, { dir: cible })
						const donnees = await fs.readJson(path.normalize(cible + '/donnees.json'))
						const parametres = JSON.parse(req.body.parametres)
						// Vérification des clés des données
						if (donnees.hasOwnProperty('type') && donnees.hasOwnProperty('titre') && donnees.hasOwnProperty('code') && donnees.hasOwnProperty('motdepasse') && donnees.hasOwnProperty('donnees') && donnees.hasOwnProperty('reponses') && donnees.hasOwnProperty('sessions') && donnees.hasOwnProperty('statut') && donnees.hasOwnProperty('session') && donnees.hasOwnProperty('date')) {
							const code = Math.floor(1000000 + Math.random() * 9000000)
							const date = dayjs().format()
							const reponse = await db.EXISTS('interactions:' + code)
							if (reponse === null) { res.send('erreur'); return false }
							if (reponse === 0) {
								if (parametres.resultats === true) {
									await db.HSET('interactions:' + code, ['type', donnees.type, 'titre', titre, 'code', code, 'motdepasse', motdepasse, 'donnees', donnees.donnees, 'reponses', donnees.reponses, 'sessions', donnees.sessions, 'statut', '', 'session', donnees.session, 'date', date, 'digidrive', 1])
								} else {
									await db.HSET('interactions:' + code, ['type', donnees.type, 'titre', titre, 'code', code, 'motdepasse', motdepasse, 'donnees', donnees.donnees, 'reponses', JSON.stringify({}), 'sessions', JSON.stringify({}), 'statut', '', 'session', 1, 'date', date, 'digidrive', 1])
								}
								if (stockage === 'fs') {
									const chemin = path.join(__dirname, '..', '/static/fichiers/' + code)
									await fs.move(path.normalize(cible + '/fichiers'), chemin)
								} else if (stockage === 's3') {
									const d = JSON.parse(donnees.donnees)
									const fichiers = definirListeFichiers(donnees.type, d)
									for (const fichier of fichiers) {
										if (fichier !== '' && await fs.pathExists(path.normalize(cible + '/fichiers/' + fichier))) {
											const buffer = await fs.readFile(path.normalize(cible + '/fichiers/' + fichier))
											await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: code + '/' + fichier, Body: buffer, ACL: 'public-read' }))
										}
									}
								}
								res.send(code.toString())
							} else {
								res.send('erreur')
							}
						} else {
							await fs.remove(source)
							await fs.remove(cible)
							res.send('donnees_corrompues')
						}
					}
				})
			} catch (err) {
				await fs.remove(path.join(__dirname, '..', '/static/temp/' + req.file.filename))
				res.send('erreur')
			}
		})
	})

	app.use(function (req, res) {
		res.redirect('/')
	})

	const port = process.env.PORT || 3000
	httpServer.listen(port)

	const io = new Server(httpServer, {
		wsEngine: eiows.Server,
		pingInterval: 95000,
    	pingTimeout: 100000,
    	maxHttpBufferSize: 1e8,
		cookie: false,
		perMessageDeflate: false
	})
	if (cluster === true) {
		io.adapter(createAdapter())
	}
	const wrap = middleware => (socket, next) => middleware(socket.request, {}, next)
	io.use(wrap(sessionMiddleware))

	io.on('connection', function (socket) {
		const req = socket.request
		socket.on('connexion', async function (donnees) {
			const code = donnees.code
			const identifiant = donnees.identifiant
			let nom = donnees.nom
			if (donnees.nomAleatoire === true) {
				const generateur = new NameForgeJS()
				const noms = generateur.generateNames()
				nom = noms[0].replace(/(^\w{1})|(\s+\w{1})/g, lettre => lettre.toUpperCase())
				req.session.nom = nom
				req.session.save()
			}
			socket.data.identifiant = identifiant
			socket.data.nom = nom
			socket.join(code)
			const clients = await io.to(code).fetchSockets()
			let utilisateurs = []
			for (let i = 0; i < clients.length; i++) {
				if (clients[i].data.identifiant === identifiant && utilisateurs.map(function (e) { return e.identifiant }).includes(identifiant) === true) {
					const nouvelIdentifiant = 'u' + Math.random().toString(16).slice(3)
					clients[i].data.identifiant = nouvelIdentifiant
					socket.data.identifiant = nouvelIdentifiant
					req.session.identifiant = nouvelIdentifiant
					req.session.save()
				}
				utilisateurs.push({ identifiant: clients[i].data.identifiant, nom: clients[i].data.nom })
			}
			utilisateurs = utilisateurs.filter((valeur, index, self) =>
				index === self.findIndex((t) => (
					t.identifiant === valeur.identifiant && t.nom === valeur.nom
				))
			)
			io.to(code).emit('connexion', utilisateurs)
		})

		socket.on('deconnexion', function (code) {
			socket.leave(code)
			socket.to(code).emit('deconnexion', req.session.identifiant)
		})

		socket.on('interactionouverte', async function (donnees) {
			const clients = await io.to(donnees.code).fetchSockets()
			let utilisateurs = []
			for (let i = 0; i < clients.length; i++) {
				utilisateurs.push({ identifiant: clients[i].data.identifiant, nom: clients[i].data.nom })
			}
			utilisateurs = utilisateurs.filter((valeur, index, self) =>
				index === self.findIndex((t) => (
					t.identifiant === valeur.identifiant && t.nom === valeur.nom
				))
			)
			socket.emit('connexion', utilisateurs)
			socket.to(donnees.code).emit('interactionouverte', donnees)
		})

		socket.on('interactionenattente', async function (donnees) {
			const clients = await io.to(donnees.code).fetchSockets()
			let utilisateurs = []
			for (let i = 0; i < clients.length; i++) {
				utilisateurs.push({ identifiant: clients[i].data.identifiant, nom: clients[i].data.nom })
			}
			utilisateurs = utilisateurs.filter((valeur, index, self) =>
				index === self.findIndex((t) => (
					t.identifiant === valeur.identifiant && t.nom === valeur.nom
				))
			)
			socket.emit('connexion', utilisateurs)
			socket.to(donnees.code).emit('interactionenattente', donnees)
		})

		socket.on('interactionverrouillee', function (code) {
			socket.to(code).emit('interactionverrouillee')
		})

		socket.on('interactiondeverrouillee', function (code) {
			socket.to(code).emit('interactiondeverrouillee')
		})

		socket.on('interactionfermee', function (code) {
			socket.to(code).emit('interactionfermee')
		})

		socket.on('utilisateursbannis', async function (donnees) {
			const code = parseInt(donnees.code)
			const utilisateursBannis = donnees.utilisateursBannis
			const identifiant = donnees.identifiant
			const type = donnees.type
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { socket.emit('erreur'); return false }
			if (reponse === 1) {
				await db.HSET('interactions:' + code, 'bannis', JSON.stringify(utilisateursBannis))
				if (type === 'banni') {
					socket.to(donnees.code).emit('utilisateurbanni', identifiant)
				} else {
					socket.to(donnees.code).emit('utilisateurautorise', identifiant)
				}
			} else {
				socket.emit('erreurcode')
			}
		})

		socket.on('nuageaffiche', function (donnees) {
			socket.to(donnees.code).emit('nuageaffiche', donnees.reponses)
		})

		socket.on('nuagemasque', function (code) {
			socket.to(code).emit('nuagemasque')
		})

		socket.on('questionsuivante', function (donnees) {
			socket.to(donnees.code).emit('questionsuivante', donnees)
		})

		socket.on('classement', function (code, donnees) {
			socket.to(code).emit('classement', donnees)
		})

		socket.on('modifiernom', function (donnees) {
			socket.to(donnees.code).emit('modifiernom', donnees)
			req.session.nom = donnees.nom
			req.session.save()
		})

		socket.on('reponse', async function (reponse) {
			const code = parseInt(reponse.code)
			const session = parseInt(reponse.session)
			const rep = await db.EXISTS('interactions:' + code)
			if (rep === null) { socket.emit('erreur'); return false }
			if (rep === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { socket.emit('erreur'); return false }
				const type = resultat.type
				let reponses = JSON.parse(resultat.reponses)
				if (!reponses[session]) {
					reponses[session] = []
				}
				if (type === 'Sondage') {
					if (reponses[session].map(function (e) { return e.identifiant }).includes(reponse.donnees.identifiant) === true) {
						reponses[session].forEach(function (item) {
							if (item.identifiant === reponse.donnees.identifiant) {
								item.reponse = reponse.donnees.reponse
								if (item.nom !== reponse.donnees.nom && reponse.donnees.nom !== '') {
									item.nom = reponse.donnees.nom
								}
							}
						})
					} else {
						reponses[session].push(reponse.donnees)
					}
				} else if (type === 'Questionnaire') {
					if (reponses[session].map(function (e) { return e.identifiant }).includes(reponse.donnees.identifiant) === true) {
						reponses[session].forEach(function (item) {
							if (item.identifiant === reponse.donnees.identifiant) {
								item.reponse = reponse.donnees.reponse
								if (reponse.donnees.hasOwnProperty('temps')) {
									item.temps = reponse.donnees.temps
								}
								if (item.nom !== reponse.donnees.nom && reponse.donnees.nom !== '') {
									item.nom = reponse.donnees.nom
								}
							}
						})
					} else {
						reponses[session].push(reponse.donnees)
					}
				} else if (type === 'Remue-méninges' || type === 'Nuage-de-mots') {
					reponses[session].push(reponse.donnees)
				}
				await db.HSET('interactions:' + code, 'reponses', JSON.stringify(reponses))
				socket.to(reponse.code).emit('reponse', reponse)
				socket.emit('reponseenvoyee', reponse)
				let reponsesSession = []
				const donneesSession = []
				let scoreTotal = 0
				if (req.session.identifiant === reponse.donnees.identifiant) {
					reponses[session].forEach(function (item) {
						if (item.identifiant === reponse.donnees.identifiant) {
							reponsesSession.push(item)
						}
					})
					if (type === 'Questionnaire' && reponsesSession[0] && reponsesSession[0].reponse) {
						let donnees = JSON.parse(resultat.donnees)
						if (donnees && donnees.hasOwnProperty('options') && ((donnees.options.hasOwnProperty('questionsAleatoires') && donnees.options.questionsAleatoires === true) || donnees.options.hasOwnProperty('itemsAleatoires') && donnees.options.itemsAleatoires === true)) {
							try {
								donnees = JSON.parse(resultat.sessions)[session].donnees
							} catch (e) {}
						}
						reponsesSession[0].reponse.forEach(function (item, index) {
							const question = donnees.questions[index]
							const reponseCorrecte = definirReponseCorrecte(question, item).reponseCorrecte
							let itemsCorrects = []
							if (donnees.options.reponses === true || donnees.options.reponses === 'oui') {
								itemsCorrects = definirReponseCorrecte(question, item).itemsCorrects
							} else if (donnees.options.reponses === 'utilisateur') {
								itemsCorrects = definirReponseCorrecte(question, item).itemsCorrects
								itemsCorrects = itemsCorrects.filter(function (element) {
									return item.includes(element)
								})
							}
							let retroaction = ''
							if (donnees.options.retroaction === true && reponseCorrecte && question.hasOwnProperty('retroaction') && question.retroaction.correcte !== '') {
								retroaction = question.retroaction.correcte
							} else if (donnees.options.retroaction === true && !reponseCorrecte && question.hasOwnProperty('retroaction') && question.retroaction.incorrecte !== '') {
								retroaction = question.retroaction.incorrecte
							}
							donneesSession.push({ reponseCorrecte: reponseCorrecte, itemsCorrects: itemsCorrects, retroaction: retroaction })
						})
						scoreTotal = calculerScoreTotal(reponsesSession[0], donnees.options, donnees.questions)
					}
				} else {
					reponsesSession = reponses[session]
				}
				socket.emit('reponses', { code: reponse.code, session: reponse.session, reponsesSession: reponsesSession, donneesSession: donneesSession, scoreTotal: scoreTotal })
				req.session.cookie.expires = new Date(Date.now() + dureeSession)
				req.session.save()
			} else {
				socket.emit('erreurcode')
			}
		})

		socket.on('modifiermessage', async function (donnees) {
			const code = parseInt(donnees.code)
			const session = parseInt(donnees.session)
			const id = donnees.id
			const texte = donnees.texte
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { socket.emit('erreur'); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { socket.emit('erreur'); return false }
				if (await verifierAdmin(code, resultat.identifiant, req.session) === true) {
					let reponses = JSON.parse(resultat.reponses)
					if (reponses[session]) {
						reponses[session].forEach(function (item) {
							if (item.reponse.id === id) {
								item.reponse.texteoriginal = item.reponse.texte
								item.reponse.texte = texte
							}
						})
						await db.HSET('interactions:' + code, 'reponses', JSON.stringify(reponses))
						io.to(donnees.code).emit('reponses', { code: donnees.code, session: donnees.session, reponsesSession: reponses[session] })
					}
				} else {
					socket.emit('erreur')
				}
			} else {
				socket.emit('erreurcode')
			}
		})

		socket.on('supprimermessage', async function (donnees) {
			const code = parseInt(donnees.code)
			const session = parseInt(donnees.session)
			const id = donnees.id
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { socket.emit('erreur'); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { socket.emit('erreur'); return false }
				if (await verifierAdmin(code, resultat.identifiant, req.session) === true) {
					let reponses = JSON.parse(resultat.reponses)
					if (reponses[session]) {
						reponses[session].forEach(function (item) {
							if (item.reponse.id === id) {
								item.reponse.visible = false
							}
						})
						await db.HSET('interactions:' + code, 'reponses', JSON.stringify(reponses))
						io.to(donnees.code).emit('reponses', { code: donnees.code, session: donnees.session, reponsesSession: reponses[session] })
					}
				} else {
					socket.emit('erreur')
				}
			} else {
				socket.emit('erreurcode')
			}
		})

		socket.on('reorganisermessages', async function (donnees) {
			const code = parseInt(donnees.code)
			const session = parseInt(donnees.session)
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { socket.emit('erreur'); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { socket.emit('erreur'); return false }
				if (await verifierAdmin(code, resultat.identifiant, req.session) === true) {
					let reponses = JSON.parse(resultat.reponses)
					if (reponses[session]) {
						reponses[session] = donnees.reponses
						await db.HSET('interactions:' + code, 'reponses', JSON.stringify(reponses))
						io.to(donnees.code).emit('reponses', { code: donnees.code, session: donnees.session, reponsesSession: reponses[session] })
						req.session.cookie.expires = new Date(Date.now() + dureeSession)
						req.session.save()
					}
				} else {
					socket.emit('erreur')
				}
			} else {
				socket.emit('erreurcode')
			}
		})

		socket.on('modifiercouleurmot', async function (donnees) {
			const code = parseInt(donnees.code)
			const session = parseInt(donnees.session)
			const mot = donnees.mot
			const couleur = donnees.couleur
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { socket.emit('erreur'); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { socket.emit('erreur'); return false }
				if (await verifierAdmin(code, resultat.identifiant, req.session) === true) {
					let reponses = JSON.parse(resultat.reponses)
					if (reponses[session]) {
						reponses[session].forEach(function (item) {
							if (item.reponse.texte === mot) {
								item.reponse.couleur = couleur
							}
						})
						await db.HSET('interactions:' + code, 'reponses', JSON.stringify(reponses))
						socket.emit('modifiercouleurmot', { code: donnees.code, session: donnees.session, reponsesSession: reponses[session] })
						req.session.cookie.expires = new Date(Date.now() + dureeSession)
						req.session.save()
					}
				} else {
					socket.emit('erreur')
				}
			} else {
				socket.emit('erreurcode')
			}
		})

		socket.on('modifiermot', async function (donnees) {
			const code = parseInt(donnees.code)
			const session = parseInt(donnees.session)
			const mot = donnees.mot
			const nouveaumot = donnees.nouveaumot
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { socket.emit('erreur'); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { socket.emit('erreur'); return false }
				if (await verifierAdmin(code, resultat.identifiant, req.session) === true) {
					let reponses = JSON.parse(resultat.reponses)
					if (reponses[session]) {
						reponses[session].forEach(function (item) {
							if (item.reponse.texte === mot) {
								item.reponse.texteoriginal = mot
								item.reponse.texte = nouveaumot
							}
						})
						await db.HSET('interactions:' + code, 'reponses', JSON.stringify(reponses))
						io.to(donnees.code).emit('reponses', { code: donnees.code, session: donnees.session, reponsesSession: reponses[session] })
					}
				} else {
					socket.emit('erreur')
				}
			} else {
				socket.emit('erreurcode')
			}
		})

		socket.on('modifiermots', async function (donnees) {
			const code = parseInt(donnees.code)
			const session = parseInt(donnees.session)
			const mots = donnees.mots
			const nouveaumot = donnees.nouveaumot
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { socket.emit('erreur'); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { socket.emit('erreur'); return false }
				if (await verifierAdmin(code, resultat.identifiant, req.session) === true) {
					let reponses = JSON.parse(resultat.reponses)
					if (reponses[session]) {
						reponses[session].forEach(function (item) {
							if (mots.includes(item.reponse.texte) === true) {
								item.reponse.texteoriginal = item.reponse.texte
								item.reponse.texte = nouveaumot
							}
						})
						await db.HSET('interactions:' + code, 'reponses', JSON.stringify(reponses))
						socket.to(donnees.code).emit('reponses', { code: donnees.code, session: donnees.session, reponsesSession: reponses[session] })
					}
				} else {
					socket.emit('erreur')
				}
			} else {
				socket.emit('erreurcode')
			}
		})

		socket.on('supprimermot', async function (donnees) {
			const code = parseInt(donnees.code)
			const session = parseInt(donnees.session)
			const mot = donnees.mot
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { socket.emit('erreur'); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { socket.emit('erreur'); return false }
				if (await verifierAdmin(code, resultat.identifiant, req.session) === true) {
					let reponses = JSON.parse(resultat.reponses)
					if (reponses[session]) {
						reponses[session].forEach(function (item) {
							if (item.reponse.texte === mot) {
								item.reponse.visible = false
							}
						})
						await db.HSET('interactions:' + code, 'reponses', JSON.stringify(reponses))
						io.to(donnees.code).emit('reponses', { code: donnees.code, session: donnees.session, reponsesSession: reponses[session] })
					}
				} else {
					socket.emit('erreur')
				}
			} else {
				socket.emit('erreurcode')
			}
		})

		socket.on('supprimermots', async function (donnees) {
			const code = parseInt(donnees.code)
			const session = parseInt(donnees.session)
			const mots = donnees.mots
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { socket.emit('erreur'); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { socket.emit('erreur'); return false }
				if (await verifierAdmin(code, resultat.identifiant, req.session) === true) {
					let reponses = JSON.parse(resultat.reponses)
					if (reponses[session]) {
						reponses[session].forEach(function (item) {
							if (mots.includes(item.reponse.texte) === true) {
								item.reponse.visible = false
							}
						})
						await db.HSET('interactions:' + code, 'reponses', JSON.stringify(reponses))
						socket.to(donnees.code).emit('reponses', { code: donnees.code, session: donnees.session, reponsesSession: reponses[session] })
					}
				} else {
					socket.emit('erreur')
				}
			} else {
				socket.emit('erreurcode')
			}
		})

		socket.on('recupererdonneesnuage', async function (donnees) {
			const code = parseInt(donnees.code)
			const session = parseInt(donnees.session)
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { socket.emit('erreur'); return false }
			if (reponse === 1) {
				let resultat = await db.HGETALL('interactions:' + code)
				resultat = Object.assign({}, resultat)
				if (resultat === null) { socket.emit('erreur'); return false }
				let reponses = JSON.parse(resultat.reponses)
				if (reponses[session]) {
					socket.emit('nuageaffiche', reponses[session])
				}
			} else {
				socket.emit('erreurcode')
			}
		})

		socket.on('modifierlangue', function (langue) {
			req.session.langue = langue
			req.session.save()
		})
	})

	async function envoyerPage (pageContextInit, res, next) {
		const pageContext = await renderPage(pageContextInit)
		const { httpResponse } = pageContext
		if (!httpResponse) {
			return next()
		}
		const { body, statusCode, headers, earlyHints } = httpResponse
		if (earlyHints103 === true && res.writeEarlyHints) {
			res.writeEarlyHints({ link: earlyHints.map((e) => e.earlyHintLink) })
		}
		if (headers) {
			headers.forEach(([name, value]) => res.setHeader(name, value))
		}
		res.status(statusCode).send(body)
	}

	async function verifierAcces (code, identifiant, motdepasse) {
		return new Promise(async function (resolve) {
			const reponse = await db.EXISTS('interactions:' + code)
			if (reponse === null) { resolve({ acces: 'erreur', utilisateur: {} }); return false }
			if (reponse === 1) {
				let donnees = await db.HGETALL('interactions:' + code)
				donnees = Object.assign({}, donnees)
				if (donnees === null) { resolve({ acces: 'erreur', utilisateur: {} }); return false }
				if (donnees.hasOwnProperty('motdepasse') && motdepasse !== '' && motdepasse === donnees.motdepasse) {
					if (!donnees.hasOwnProperty('digidrive') || (donnees.hasOwnProperty('digidrive') && parseInt(donnees.digidrive) === 0)) {
						await db.HSET('interactions:' + code, 'digidrive', 1)
					}
					resolve({ acces: 'interaction_debloquee', utilisateur: {} })
				} else if (identifiant === donnees.identifiant && donnees.hasOwnProperty('motdepasse') && donnees.motdepasse === '') {
					const resultat = await db.EXISTS('utilisateurs:' + identifiant)
					if (resultat === null) { resolve({ acces: 'erreur', utilisateur: {} }); return false }
					if (resultat === 1) {
						let utilisateur = await db.HGETALL('utilisateurs:' + identifiant)
						utilisateur = Object.assign({}, utilisateur)
						if (utilisateur === null) { resolve({ acces: 'erreur', utilisateur: {} }); return false }
						if (motdepasse.trim() !== '' && utilisateur.hasOwnProperty('motdepasse') && utilisateur.motdepasse.trim() !== '' && await bcrypt.compare(motdepasse, utilisateur.motdepasse)) {
							if (!donnees.hasOwnProperty('digidrive') || (donnees.hasOwnProperty('digidrive') && parseInt(donnees.digidrive) === 0)) {
								await db.HSET('interactions:' + code, 'digidrive', 1)
							}
							resolve({ acces: 'interaction_debloquee', utilisateur: utilisateur })
						} else {
							resolve({ acces: 'erreur', utilisateur: {} })
						}
					} else {
						resolve({ acces: 'erreur', utilisateur: {} })
					}
				} else {
					resolve({ acces: 'erreur', utilisateur: {} })
				}
			} else {
				resolve({ acces: 'erreur', utilisateur: {} })
			}
		})
	}

	function creerMotDePasse () {
		let motdepasse = ''
		const lettres = 'abcdefghijklmnopqrstuvwxyz1234567890'
		for (let i = 0; i < 6; i++) {
			motdepasse += lettres.charAt(Math.floor(Math.random() * 36))
		}
		return motdepasse
	}

	function formaterDate (date, mot, langue) {
		let dateFormattee = ''
		switch (langue) {
			case 'fr':
				dateFormattee = mot + ' le ' + date
				break
			case 'en':
				dateFormattee = mot + ' on ' + date
				break
			case 'es':
				dateFormattee = mot + ' el ' + date
				break
			case 'it':
				dateFormattee = mot + ' il ' + date
				break
			case 'de':
				dateFormattee = mot + ' am ' + date
				break
		}
		return dateFormattee
	}

	function definirReponseCorrecte (question, reponse) {
		const itemsCorrects = []
		const bonnesReponses = []
		const mauvaisesReponses = []
		if (question.option !== 'texte-court') {
			question.items.forEach(function (item) {
				if (item.reponse === true && item.texte !== '') {
					itemsCorrects.push(item.texte)
				} else if (item.reponse === true && item.image && item.image !== '') {
					itemsCorrects.push(item.image)
				} else if (item.reponse === true && item.audio && item.audio !== '') {
					itemsCorrects.push(item.audio)
				}
			})
			question.items.forEach(function (item) {
				if (item.reponse === true && (reponse.includes(item.texte) || (item.hasOwnProperty('image') && reponse.includes(item.image)) || (item.hasOwnProperty('audio') && reponse.includes(item.audio)))) {
					bonnesReponses.push(item)
				} else if (item.reponse === false && (reponse.includes(item.texte) || (item.hasOwnProperty('image') && reponse.includes(item.image)) || (item.hasOwnProperty('audio') && reponse.includes(item.audio)))) {
					mauvaisesReponses.push(item)
				}
			})
		} else {
			const reponsesTexte = question.reponses.split('|')
			reponsesTexte.forEach(function (item, index) {
				reponsesTexte[index] = item.trim()
			})
			itemsCorrects.push(...reponsesTexte)
		}
		if ((question.option === 'choix-unique' && bonnesReponses.length > 0) || (question.option === 'choix-multiples' && itemsCorrects.every(i => reponse.includes(i)) === true && mauvaisesReponses.length === 0) || (question.option === 'texte-court' && itemsCorrects.includes(reponse.toString().trim()) === true && mauvaisesReponses.length === 0)) {
			return { reponseCorrecte: true, itemsCorrects: itemsCorrects }
		} else {
			return { reponseCorrecte: false, itemsCorrects: itemsCorrects }
		}
	}

	function calculerScoreTotal (reponsesSession, options, questions) {
		let score = 0
		let scoreTemps = []
		let temps = []
		const reponses = reponsesSession.reponse
		if (reponsesSession.hasOwnProperty('score') && options.points !== 'classique') {
			scoreTemps = reponsesSession.score
		}
		if (reponsesSession.hasOwnProperty('temps') && options.points !== 'classique') {
			temps = reponsesSession.temps
		}
		if (scoreTemps.length > 0) {
			scoreTemps.forEach(function (points) {
				score = score + points
			})
		} else if (reponses.length > 0) {
			questions.forEach(function (question, indexQuestion) {
				if (reponses[indexQuestion]) {
					const reponseCorrecte = []
					const bonnesReponses = []
					const mauvaisesReponses = []
					if (question.option !== 'texte-court') {
						question.items.forEach(function (item) {
							if (item.reponse === true && item.texte !== '') {
								reponseCorrecte.push(item.texte)
							} else if (item.reponse === true && item.image && item.image !== '') {
								reponseCorrecte.push(item.image)
							} else if (item.reponse === true && item.audio && item.audio !== '') {
								reponseCorrecte.push(item.audio)
							}
						})
						question.items.forEach(function (item) {
							if (item.reponse === true && (reponses[indexQuestion].includes(item.texte) || (item.hasOwnProperty('image') && reponses[indexQuestion].includes(item.image)) || (item.hasOwnProperty('audio') && reponses[indexQuestion].includes(item.audio)))) {
								bonnesReponses.push(item)
							} else if (item.reponse === false && (reponses[indexQuestion].includes(item.texte) || (item.hasOwnProperty('image') && reponses[indexQuestion].includes(item.image)) || (item.hasOwnProperty('audio') && reponses[indexQuestion].includes(item.audio)))) {
								mauvaisesReponses.push(item)
							}
						})
					} else {
						const reponsesTexte = question.reponses.split('|')
						reponsesTexte.forEach(function (item, index) {
							reponsesTexte[index] = item.trim()
						})
						if (reponsesTexte.includes(reponses[indexQuestion].toString().trim()) === true) {
							bonnesReponses.push(reponses[indexQuestion].toString())
						}
						reponseCorrecte.push(question.reponses)
					}
					let multiplicateurSecondes = 10
					if (options.hasOwnProperty('multiplicateur') && options.multiplicateur > 0) {
						multiplicateurSecondes = options.multiplicateur
					}
					if (((question.option === 'choix-unique' && bonnesReponses.length > 0) || (question.option === 'texte-court' && bonnesReponses.length > 0) || (question.option === 'choix-multiples' && reponseCorrecte.every(i => reponses[indexQuestion].includes(i)) === true && mauvaisesReponses.length === 0)) && options.points === 'classique' && question.hasOwnProperty('points')) {
						score = score + question.points
					} else if (((question.option === 'choix-unique' && bonnesReponses.length > 0) || (question.option === 'texte-court' && bonnesReponses.length > 0) || (question.option === 'choix-multiples' && reponseCorrecte.every(i => reponses[indexQuestion].includes(i)) === true && mauvaisesReponses.length === 0)) && options.points === 'classique' && !question.hasOwnProperty('points')) {
						score = score + 1000
					} else if (((question.option === 'choix-unique' && bonnesReponses.length > 0) || (question.option === 'texte-court' && bonnesReponses.length > 0) || (question.option === 'choix-multiples' && reponseCorrecte.every(i => reponses[indexQuestion].includes(i)) === true && mauvaisesReponses.length === 0)) && options.points !== 'classique' && question.hasOwnProperty('points')) {
						score = score + Math.round(question.points - (temps[indexQuestion] * multiplicateurSecondes))
					} else if (((question.option === 'choix-unique' && bonnesReponses.length > 0) || (question.option === 'texte-court' && bonnesReponses.length > 0) || (question.option === 'choix-multiples' && reponseCorrecte.every(i => reponses[indexQuestion].includes(i)) === true && mauvaisesReponses.length === 0)) && options.points !== 'classique' && !question.hasOwnProperty('points')) {
						score = score + Math.round(1000 - (temps[indexQuestion] * multiplicateurSecondes))
					} else if ((bonnesReponses.length - mauvaisesReponses.length) > 0 && options.points === 'classique' && question.hasOwnProperty('points')) {
						score = score + ((question.points / reponseCorrecte.length) * (bonnesReponses.length - mauvaisesReponses.length))
					} else if ((bonnesReponses.length - mauvaisesReponses.length) > 0 && options.points === 'classique' && !question.hasOwnProperty('points')) {
						score = score + ((1000 / reponseCorrecte.length) * (bonnesReponses.length - mauvaisesReponses.length))
					} else if ((bonnesReponses.length - mauvaisesReponses.length) > 0 && options.points !== 'classique' && question.hasOwnProperty('points')) {
						score = score + ((Math.round(question.points - (temps[indexQuestion] * multiplicateurSecondes)) / reponseCorrecte.length) * (bonnesReponses.length - mauvaisesReponses.length))
					} else if ((bonnesReponses.length - mauvaisesReponses.length) > 0 && options.points !== 'classique' && !question.hasOwnProperty('points')) {
						score = score + ((Math.round(1000 - (temps[indexQuestion] * multiplicateurSecondes)) / reponseCorrecte.length) * (bonnesReponses.length - mauvaisesReponses.length))
					} else {
						score = score + 0
					}
				}
			})
		}
		return score
	}

	function definirMessagesRemueMeninges (categories, reponses, bannis) {
		const messagesVisibles = []
		const messagesSupprimes = []
		for (let i = 0; i < categories.length; i++) {
			messagesVisibles.push([])
			messagesSupprimes.push([])
		}
		if (messagesVisibles.length > 0) {
			reponses.forEach(function (item) {
				let index = -1
				categories.forEach(function (categorie, indexCategorie) {
					if (item.reponse.categorie === categorie.texte || item.reponse.categorie === categorie.image) {
						index = indexCategorie
					}
				})
				if (!bannis.includes(item.identifiant) && item.reponse.visible && index > -1) {
					messagesVisibles[index].push(item)
				} else if (index > -1) {
					messagesSupprimes[index].push(item)
				}
			})
		} else {
			reponses.forEach(function (item) {
				if (!bannis.includes(item.identifiant) && item.reponse.visible) {
					messagesVisibles.push(item)
				} else {
					messagesSupprimes.push(item)
				}
			})
		}
		return { visibles: messagesVisibles, supprimes: messagesSupprimes }
	}

	function definirMotsNuageDeMots (reponses, bannis) {
		const messagesVisibles = []
		const messagesSupprimes = []
		reponses.forEach(function (item) {
			if (!bannis.includes(item.identifiant) && item.reponse.visible) {
				messagesVisibles.push(item)
			} else {
				messagesSupprimes.push(item)
			}
		})
		return { visibles: messagesVisibles, supprimes: messagesSupprimes }
	}

	function definirStatistiquesQuestions (questions, reponses, bannis) {
		const statistiques = []
		questions.forEach(function (question, indexQuestion) {
			const personnes = []
			const pourcentages = []
			if (question.hasOwnProperty('option') && (question.option === 'choix-unique' || question.option === 'choix-multiples') && question.hasOwnProperty('items')) {
				for (let i = 0; i < question.items.length; i++) {
					personnes.push(0)
					pourcentages.push(0)
				}
				question.items.forEach(function (item, index) {
					let total = 0
					let nombreReponses = 0
					reponses.forEach(function (donnees) {
						if (!bannis.includes(donnees.identifiant)) {
							donnees.reponse[indexQuestion].forEach(function (reponse) {
								if (reponse === item.texte || (item.hasOwnProperty('image') && reponse === item.image) || (item.hasOwnProperty('audio') && reponse === item.audio)) {
									nombreReponses++
								}
							})
							total++
						}
					})
					if (nombreReponses > 0) {
						personnes[index] = nombreReponses
						const pourcentage = (nombreReponses / total) * 100
						pourcentages[index] = Math.round(pourcentage)
					}
				})
			} else if (question.hasOwnProperty('option') && question.option === 'texte-court') {
				let items = []
				reponses.forEach(function (donnees) {
					donnees.reponse[indexQuestion].forEach(function (reponse) {
						if (!bannis.includes(donnees.identifiant) && !items.includes(reponse.toString().trim())) {
							items.push(reponse.toString().trim())
						}
					})
				})
				for (let i = 0; i < items.length; i++) {
					personnes.push(0)
					pourcentages.push(0)
				}
				items.forEach(function (item, index) {
					let total = 0
					let nombreReponses = 0
					reponses.forEach(function (donnees) {
						if (!bannis.includes(donnees.identifiant)) {
							donnees.reponse[indexQuestion].forEach(function (reponse) {
								if (item === reponse.toString().trim()) {
									nombreReponses++
								}
								total++
							})
						}
					})
					if (nombreReponses > 0) {
						personnes[index] = nombreReponses
						const pourcentage = (nombreReponses / total) * 100
						pourcentages[index] = Math.round(pourcentage)
					}
				})
			} else if (question.hasOwnProperty('option') && question.option === 'etoiles') {
				for (let i = 0; i < question.etoiles; i++) {
					personnes.push(0)
					pourcentages.push(0)
					let total = 0
					let nombreReponses = 0
					reponses.forEach(function (donnees) {
						if (!bannis.includes(donnees.identifiant)) {
							donnees.reponse[indexQuestion].forEach(function (reponse) {
								if (reponse === (i + 1)) {
									nombreReponses++
								}
								total++
							}.bind(this))
						}
					}.bind(this))
					if (nombreReponses > 0) {
						personnes[i] = nombreReponses
						const pourcentage = (nombreReponses / total) * 100
						pourcentages[i] = Math.round(pourcentage)
					}
				}
			}
			statistiques.push({ personnes: personnes, pourcentages: pourcentages })
		})
		return statistiques
	}

	function definirReponses (reponses, indexQuestion, bannis) {
		let total = 0
		reponses.forEach(function (item) {
			if (!bannis.includes(item.identifiant) && item.hasOwnProperty('reponse') && item.reponse[indexQuestion].length > 0) {
				total++
			}
		})
		return total
	}

	function genererMotDePasse (longueur) {
		function rand (max) {
			return Math.floor(Math.random() * max)
		}
		function verifierMotDePasse (motdepasse, regex, caracteres) {
			if (!regex.test(motdepasse)) {
				const nouveauCaractere = caracteres.charAt(rand(caracteres.length))
				const position = rand(motdepasse.length + 1)
				motdepasse = motdepasse.slice(0, position) + nouveauCaractere + motdepasse.slice(position)
			}
			return motdepasse
		}
		const listeCaracteres = '123456789abcdefghijklmnopqrstuvwxyz'
		const caracteresSpeciaux = '!#$@*'
		const specialRegex = /[!#\$@*]/
		const majuscules = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
		const majusculesRegex = /[A-Z]/

		const caracteres = listeCaracteres.split('')
		let motdepasse = ''
		let index

		while (motdepasse.length < longueur) {
			index = rand(caracteres.length)
			motdepasse += caracteres[index]
			caracteres.splice(index, 1)
		}
		motdepasse = verifierMotDePasse(motdepasse, specialRegex, caracteresSpeciaux)
		motdepasse = verifierMotDePasse(motdepasse, majusculesRegex, majuscules)
		return motdepasse  
	}

	function verifierEmail (email) {
		const regexExp = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/gi
		return regexExp.test(email)
	}

	function melanger (array) {
		for (let i = array.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1))
			const temp = array[i]
			array[i] = array[j]
			array[j] = temp
		}
		return array
	}

	function supprimerSession (req) {
		if (req.hasOwnProperty('session')) {
			req.session.identifiant = ''
			req.session.motdepasse = ''
			req.session.nom = ''
			req.session.email = ''
			req.session.langue = ''
			req.session.role = ''
			req.session.interactions = []
			req.session.destroy()
		}
	}

	async function verifierAdmin (code, identifiant, session) {
		return new Promise(async function (resolve) {
			if (session.hasOwnProperty('identifiant') && session.hasOwnProperty('role') && session.role === 'utilisateur' && session.hasOwnProperty('motdepasse')) {
				let donneesUtilisateur = await db.HGETALL('utilisateurs:' + session.identifiant)
				donneesUtilisateur = Object.assign({}, donneesUtilisateur)
				if (donneesUtilisateur === null || !donneesUtilisateur.hasOwnProperty('motdepasse')) { resolve('erreur'); return false }
				if (identifiant === session.identifiant && await bcrypt.compare(session.motdepasse, donneesUtilisateur.motdepasse)) {
					resolve(true)
				} else {
					resolve(false)
				}
			} else if (session.hasOwnProperty('role') && session.role === 'auteur' && session.hasOwnProperty('interactions') && session.interactions.map(item => item.code).includes(parseInt(code))) {
				resolve(true)
			} else {
				resolve(false)
			}
		})
	}

	async function lireFichierS3 (cle) {
		return new Promise(async function (resolve) {
			const donnees = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: cle }))
			const buffers = []
			for await (const buffer of donnees.Body) buffers.push(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer))
			resolve(Buffer.concat(buffers))
		})
	}

	async function telechargerFichierS3 (cle, fichier) {
		return new Promise(async function (resolve) {
			const donnees = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: cle }))
			const writeStream = fs.createWriteStream(fichier)
			donnees.Body.pipe(writeStream)
			writeStream.on('finish', function () {
				resolve('termine')
			})
			writeStream.on('error', function () {
				resolve('erreur')
			})
		})
	}

	function definirListeFichiers (type, donnees) {
		const fichiers = []
		if (Object.keys(donnees.support).length > 0) {
			if (donnees.support.hasOwnProperty('fichier')) {
				fichiers.push(donnees.support.fichier)
			} else if (donnees.support.hasOwnProperty('image')) {
				fichiers.push(donnees.support.image)
			}
		}
		if (type === 'Sondage' || type === 'Questionnaire') {
			donnees.questions.forEach(function (q) {
				if (Object.keys(q.support).length > 0) {
					if (q.support.hasOwnProperty('fichier')) {
						fichiers.push(q.support.fichier)
					} else if (q.support.hasOwnProperty('image')) {
						fichiers.push(q.support.image)
					} else if (q.support.hasOwnProperty('audio')) {
						fichiers.push(q.support.audio)
					}
				}
				if (q.hasOwnProperty('items')) {
					q.items.forEach(function (item) {
						if (item.hasOwnProperty('image') && item.image !== '') {
							fichiers.push(item.image)
						}
						if (item.hasOwnProperty('audio') && item.audio !== '') {
							fichiers.push(item.audio)
						}
					})
				}
			})
		} else if (type === 'Remue-méninges') {
			donnees.categories.forEach(function (categorie) {
				if (categorie.image !== '') {
					fichiers.push(categorie.image)
				}
			})
		}
		return fichiers
	}

	function definirNomFichier (fichier) {
		const info = path.parse(fichier)
		const extension = info.ext.toLowerCase()
		let nom = v.latinise(info.name.toLowerCase())
		nom = nom.replace(/\ /gi, '-')
		nom = nom.replace(/[^0-9a-z_\-]/gi, '')
		if (nom.length > 100) {
			nom = nom.substring(0, 100)
		}
		nom = nom + '_' + Math.random().toString(36).substring(2) + extension
		return nom
	}

	const televerser = multer({
		storage: multer.diskStorage({
			destination: function (req, fichier, callback) {
				const code = req.body.code
				const chemin = path.join(__dirname, '..', '/static/fichiers/' + code + '/')
				callback(null, chemin)
			},
			filename: function (req, fichier, callback) {
				const nom = definirNomFichier(fichier.originalname)
				callback(null, nom)
			}
		})
	}).single('fichier')

	const televerserArchive = multer({
		storage: multer.diskStorage({
			destination: function (req, fichier, callback) {
				const chemin = path.join(__dirname, '..', '/static/temp/')
				callback(null, chemin)
			},
			filename: function (req, fichier, callback) {
				const nom = definirNomFichier(fichier.originalname)
				callback(null, nom)
			}
		})
	}).single('fichier')

	function recupererDonnees (identifiant) {
		const donneesInteractionsCreees = new Promise(async function (resolveMain) {
			const interactions = await db.SMEMBERS('interactions-creees:' + identifiant)
			const donneeInteractions = []
			if (interactions === null) { resolveMain(donneeInteractions); return false }
			for (const interaction of interactions) {
				const donneeInteraction = new Promise(async function (resolve) {
					let donnees = await db.HGETALL('interactions:' + interaction)
					donnees = Object.assign({}, donnees)
					if (donnees === null) { resolve({}); return false }
					resolve(donnees)
				})
				donneeInteractions.push(donneeInteraction)
			}
			Promise.all(donneeInteractions).then(function (resultat) {
				resolveMain(resultat)
			})
		})
		const donneesInteractionsSupprimees = new Promise(async function (resolveMain) {
			const interactions = await db.SMEMBERS('interactions-supprimees:' + identifiant)
			const donneeInteractions = []
			if (interactions === null) { resolveMain(donneeInteractions); return false }
			for (const interaction of interactions) {
				const donneeInteraction = new Promise(async function (resolve) {
					let donnees = await db.HGETALL('interactions:' + interaction)
					donnees = Object.assign({}, donnees)
					if (donnees === null) { resolve({}); return false }
					resolve(donnees)
				})
				donneeInteractions.push(donneeInteraction)
			}
			Promise.all(donneeInteractions).then(function (resultat) {
				resolveMain(resultat)
			})
		})
		const donneesFavoris = new Promise(async function (resolveMain) {
			const favoris = await db.SMEMBERS('favoris:' + identifiant)
			const donneeFavoris = []
			if (favoris === null) { resolveMain(donneeFavoris); return false }
			for (const interaction of favoris) {
				const donneeFavori = new Promise(async function (resolve) {
					let donnees = await db.HGETALL('interactions:' + interaction)
					donnees = Object.assign({}, donnees)
					if (donnees === null) { resolve({}); return false }
					resolve(donnees)
				})
				donneeFavoris.push(donneeFavori)
			}
			Promise.all(donneeFavoris).then(function (resultat) {
				resolveMain(resultat)
			})
		})
		const donneesUtilisateur = new Promise(async function (resolve) {
			const filtre = 'date-desc'
			const reponse = await db.EXISTS('utilisateurs:' + identifiant)
			if (reponse === null) { resolve(filtre); return false }
			if (reponse === 1) {
				let donnees = await db.HGETALL('utilisateurs:' + identifiant)
				donnees = Object.assign({}, donnees)
				if (donnees.hasOwnProperty('filtre')) {
					resolve(donnees.filtre)
				} else {
					resolve(filtre)
				}
			} else {
				resolve(filtre)
			}
		})
		return Promise.all([donneesInteractionsCreees, donneesInteractionsSupprimees, donneesFavoris, donneesUtilisateur])
	}

	async function supprimerFichier (code, fichier) {
		const chemin = path.join(__dirname, '..', '/static/fichiers/' + code + '/' + fichier)
		if (stockage === 'fs' && fichier !== '' && await fs.pathExists(chemin)) {
			await fs.remove(chemin)
		} else if (stockage === 's3' && fichier !== '') {
			await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: code + '/' + fichier }))
		}
	}
}
