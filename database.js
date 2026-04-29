const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "ponto.sqlite");
const LEGACY_COLABORADORAS_PATH = path.join(__dirname, "assets", "colaboradoras.json");
const LEGACY_REGISTROS_PATH = path.join(__dirname, "assets", "registros_pontos.json");

const VALID_PONTO_TYPES = new Set([
  "entrada",
  "saida_almoco",
  "volta_almoco",
  "saida",
]);

const DEFAULT_SCHEDULE = {
  horario_inicio: "08:00",
  horario_saida: "17:00",
  horario_descanso: "12:00-13:00",
};

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_BYTES = 16;

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

function normalizeCpf(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeTime(value) {
  const text = String(value ?? "").trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : "";
}

function normalizeDate(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizePassword(value) {
  return String(value ?? "").trim();
}

function safeJsonParse(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function serializeFaceDescriptor(faceDescriptor) {
  return Array.isArray(faceDescriptor) && faceDescriptor.length > 0
    ? JSON.stringify(faceDescriptor)
    : null;
}

function normalizePhotoDataUrl(value) {
  const text = String(value ?? "").trim();
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(text) ? text : null;
}

function deserializeFaceDescriptor(value) {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch (_error) {
    return undefined;
  }
}

function hashPassword(password) {
  const normalized = normalizePassword(password);
  if (!normalized) {
    return null;
  }

  const salt = crypto.randomBytes(PASSWORD_SALT_BYTES).toString("hex");
  const hash = crypto.scryptSync(normalized, salt, PASSWORD_KEY_LENGTH).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const normalized = normalizePassword(password);
  const text = String(storedHash ?? "");
  const [algorithm, salt, expectedHash] = text.split("$");

  if (!normalized || algorithm !== "scrypt" || !salt || !expectedHash) {
    return false;
  }

  const derivedHash = crypto.scryptSync(normalized, salt, PASSWORD_KEY_LENGTH);
  const expectedBuffer = Buffer.from(expectedHash, "hex");

  if (derivedHash.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedHash, expectedBuffer);
}

function mapColaboradora(row, { includeFaceDescriptor = false } = {}) {
  if (!row) {
    return null;
  }

  const colaboradora = {
    nome: row.nome,
    cpf: row.cpf,
    horario_inicio: row.horario_inicio,
    horario_saida: row.horario_saida,
    horario_descanso: row.horario_descanso,
    tem_foto: Boolean(row.foto_perfil),
    tem_senha: Boolean(row.senha_hash),
    foto_perfil: row.foto_perfil || "",
  };

  if (includeFaceDescriptor) {
    const faceDescriptor = deserializeFaceDescriptor(row.face_descriptor);
    if (faceDescriptor) {
      colaboradora.face_descriptor = faceDescriptor;
    }
  }

  return colaboradora;
}

function getMeta(key) {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key);
  return row?.value ?? null;
}

function setMeta(key, value) {
  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value
  `).run(key, value);
}

function ensureColaboradoraDefaults(payload = {}) {
  return {
    horario_inicio: normalizeTime(payload.horario_inicio) || DEFAULT_SCHEDULE.horario_inicio,
    horario_saida: normalizeTime(payload.horario_saida) || DEFAULT_SCHEDULE.horario_saida,
    horario_descanso:
      String(payload.horario_descanso ?? DEFAULT_SCHEDULE.horario_descanso).trim() ||
      DEFAULT_SCHEDULE.horario_descanso,
  };
}

function explodeLegacyDayRecords(dias) {
  if (!Array.isArray(dias)) {
    return [];
  }

  const normalized = [];

  for (const dia of dias) {
    const data = normalizeDate(dia?.data);
    if (!data) {
      continue;
    }

    if (VALID_PONTO_TYPES.has(dia?.tipo) && normalizeTime(dia?.hora)) {
      normalized.push({
        data,
        tipo: dia.tipo,
        hora: normalizeTime(dia.hora),
      });
      continue;
    }

    for (const tipo of VALID_PONTO_TYPES) {
      const hora = normalizeTime(dia?.[tipo]);
      if (!hora) {
        continue;
      }

      normalized.push({ data, tipo, hora });
    }
  }

  return normalized;
}

function initializeSchema() {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS colaboradoras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      cpf TEXT NOT NULL UNIQUE,
      horario_inicio TEXT NOT NULL,
      horario_saida TEXT NOT NULL,
      horario_descanso TEXT NOT NULL,
      senha_hash TEXT,
      face_descriptor TEXT,
      foto_perfil TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS registros_ponto (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      colaboradora_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('entrada', 'saida_almoco', 'volta_almoco', 'saida')),
      hora TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(colaboradora_id, data, tipo),
      FOREIGN KEY(colaboradora_id) REFERENCES colaboradoras(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_colaboradoras_nome ON colaboradoras(nome);
    CREATE INDEX IF NOT EXISTS idx_registros_ponto_data ON registros_ponto(data);
    CREATE INDEX IF NOT EXISTS idx_registros_ponto_colab_data ON registros_ponto(colaboradora_id, data);
  `);
}

function ensureOptionalSchema() {
  const colaboradoraColumns = db.prepare("PRAGMA table_info(colaboradoras)").all();
  const hasFotoPerfil = colaboradoraColumns.some((column) => column.name === "foto_perfil");
  const hasSenhaHash = colaboradoraColumns.some((column) => column.name === "senha_hash");

  if (!hasFotoPerfil) {
    db.exec("ALTER TABLE colaboradoras ADD COLUMN foto_perfil TEXT");
  }

  if (!hasSenhaHash) {
    db.exec("ALTER TABLE colaboradoras ADD COLUMN senha_hash TEXT");
  }
}

function migrateLegacyDataIfNeeded() {
  if (getMeta("legacy_import_completed")) {
    return;
  }

  const upsertColaboradoraStatement = db.prepare(`
    INSERT INTO colaboradoras (
      nome,
      cpf,
      horario_inicio,
      horario_saida,
      horario_descanso,
      face_descriptor,
      foto_perfil
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cpf) DO UPDATE SET
      nome = excluded.nome,
      horario_inicio = excluded.horario_inicio,
      horario_saida = excluded.horario_saida,
      horario_descanso = excluded.horario_descanso,
      face_descriptor = COALESCE(excluded.face_descriptor, colaboradoras.face_descriptor),
      foto_perfil = COALESCE(excluded.foto_perfil, colaboradoras.foto_perfil),
      updated_at = CURRENT_TIMESTAMP
  `);

  const findColaboradoraIdStatement = db.prepare(`
    SELECT id
    FROM colaboradoras
    WHERE cpf = ?
  `);

  const upsertRegistroStatement = db.prepare(`
    INSERT INTO registros_ponto (
      colaboradora_id,
      data,
      tipo,
      hora
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(colaboradora_id, data, tipo) DO UPDATE SET
      hora = excluded.hora,
      updated_at = CURRENT_TIMESTAMP
  `);

  const legacyColaboradoras = safeJsonParse(LEGACY_COLABORADORAS_PATH, { colaboradoras: [] });
  const legacyRegistros = safeJsonParse(LEGACY_REGISTROS_PATH, { registros_ponto: [] });

  db.exec("BEGIN");

  try {
    for (const colaboradora of legacyColaboradoras.colaboradoras ?? []) {
      const cpf = normalizeCpf(colaboradora?.cpf);
      const nome = String(colaboradora?.nome ?? "").trim();

      if (!cpf || !nome) {
        continue;
      }

      const defaults = ensureColaboradoraDefaults(colaboradora);

      upsertColaboradoraStatement.run(
        nome,
        cpf,
        defaults.horario_inicio,
        defaults.horario_saida,
        defaults.horario_descanso,
        serializeFaceDescriptor(colaboradora?.face_descriptor),
        normalizePhotoDataUrl(colaboradora?.foto_perfil),
      );
    }

    for (const colaboradora of legacyRegistros.registros_ponto ?? []) {
      const cpf = normalizeCpf(colaboradora?.cpf);
      const nome = String(colaboradora?.nome ?? "").trim() || "Colaboradora sem nome";

      if (!cpf) {
        continue;
      }

      if (!findColaboradoraIdStatement.get(cpf)) {
        const defaults = ensureColaboradoraDefaults();

        upsertColaboradoraStatement.run(
          nome,
          cpf,
          defaults.horario_inicio,
          defaults.horario_saida,
          defaults.horario_descanso,
          null,
          null,
        );
      }

      const colaboradoraRow = findColaboradoraIdStatement.get(cpf);
      if (!colaboradoraRow) {
        continue;
      }

      for (const registro of explodeLegacyDayRecords(colaboradora?.dias)) {
        upsertRegistroStatement.run(
          colaboradoraRow.id,
          registro.data,
          registro.tipo,
          registro.hora,
        );
      }
    }

    setMeta("legacy_import_completed", new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function findRawColaboradoraByCpf(cpf) {
  return db.prepare(`
    SELECT
      id,
      nome,
      cpf,
      horario_inicio,
      horario_saida,
      horario_descanso,
      senha_hash,
      face_descriptor,
      foto_perfil
    FROM colaboradoras
    WHERE cpf = ?
  `).get(normalizeCpf(cpf));
}

function listColaboradoras({ includeFaceDescriptor = false } = {}) {
  const rows = db.prepare(`
    SELECT
      nome,
      cpf,
      horario_inicio,
      horario_saida,
      horario_descanso,
      senha_hash,
      face_descriptor,
      foto_perfil
    FROM colaboradoras
    ORDER BY nome COLLATE NOCASE
  `).all();

  return rows.map((row) => mapColaboradora(row, { includeFaceDescriptor }));
}

function findColaboradoraByCpf(cpf, { includeFaceDescriptor = false } = {}) {
  const row = findRawColaboradoraByCpf(cpf);
  return mapColaboradora(row, { includeFaceDescriptor });
}

function upsertColaboradora(payload) {
  const cpf = normalizeCpf(payload?.cpf);
  const nome = String(payload?.nome ?? "").trim();
  const horario_inicio = normalizeTime(payload?.horario_inicio);
  const horario_saida = normalizeTime(payload?.horario_saida);
  const horario_descanso = String(payload?.horario_descanso ?? "").trim();

  const existing = findRawColaboradoraByCpf(cpf);
  const senha = normalizePassword(payload?.senha);

  if (!cpf || !nome || !horario_inicio || !horario_saida || !horario_descanso) {
    throw new Error("INVALID_COLABORADORA_PAYLOAD");
  }

  const senhaHash = senha ? hashPassword(senha) : null;
  const faceDescriptor = serializeFaceDescriptor(payload?.face_descriptor);
  const fotoPerfil = normalizePhotoDataUrl(payload?.foto_perfil);

  db.prepare(`
    INSERT INTO colaboradoras (
      nome,
      cpf,
      horario_inicio,
      horario_saida,
      horario_descanso,
      senha_hash,
      face_descriptor,
      foto_perfil
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cpf) DO UPDATE SET
      nome = excluded.nome,
      horario_inicio = excluded.horario_inicio,
      horario_saida = excluded.horario_saida,
      horario_descanso = excluded.horario_descanso,
      senha_hash = COALESCE(excluded.senha_hash, colaboradoras.senha_hash),
      face_descriptor = COALESCE(excluded.face_descriptor, colaboradoras.face_descriptor),
      foto_perfil = COALESCE(excluded.foto_perfil, colaboradoras.foto_perfil),
      updated_at = CURRENT_TIMESTAMP
  `).run(
    nome,
    cpf,
    horario_inicio,
    horario_saida,
    horario_descanso,
    senhaHash,
    faceDescriptor,
    fotoPerfil,
  );

  return {
    isUpdate: Boolean(existing),
    colaboradora: findColaboradoraByCpf(cpf, { includeFaceDescriptor: true }),
  };
}

function authenticateColaboradora(payload) {
  const cpf = normalizeCpf(payload?.cpf);
  const senha = normalizePassword(payload?.senha);

  if (!cpf || !senha) {
    throw new Error("INVALID_LOGIN_PAYLOAD");
  }

  const colaboradora = findRawColaboradoraByCpf(cpf);
  if (!colaboradora) {
    return { notFound: true };
  }

  if (!colaboradora.senha_hash) {
    return { missingPassword: true };
  }

  if (!verifyPassword(senha, colaboradora.senha_hash)) {
    return { invalidPassword: true };
  }

  return {
    colaboradora: findColaboradoraByCpf(cpf, { includeFaceDescriptor: true }),
  };
}

function deleteColaboradora(cpf) {
  const normalizedCpf = normalizeCpf(cpf);
  if (!normalizedCpf) {
    throw new Error("INVALID_CPF");
  }

  const colaboradora = findRawColaboradoraByCpf(normalizedCpf);
  if (!colaboradora) {
    return { notFound: true };
  }

  db.prepare(`
    DELETE FROM colaboradoras
    WHERE cpf = ?
  `).run(normalizedCpf);

  return {
    notFound: false,
    colaboradora: mapColaboradora(colaboradora),
  };
}

function registerPonto(payload) {
  const cpf = normalizeCpf(payload?.cpf);
  const tipo = String(payload?.tipo ?? "").trim();
  const data = normalizeDate(payload?.data);
  const hora = normalizeTime(payload?.hora);

  if (!cpf || !VALID_PONTO_TYPES.has(tipo) || !data || !hora) {
    throw new Error("INVALID_REGISTRO_PAYLOAD");
  }

  const colaboradora = findRawColaboradoraByCpf(cpf);
  if (!colaboradora) {
    return { notFound: true };
  }

  const existing = db.prepare(`
    SELECT id
    FROM registros_ponto
    WHERE colaboradora_id = ?
      AND data = ?
      AND tipo = ?
  `).get(colaboradora.id, data, tipo);

  db.prepare(`
    INSERT INTO registros_ponto (
      colaboradora_id,
      data,
      tipo,
      hora
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(colaboradora_id, data, tipo) DO UPDATE SET
      hora = excluded.hora,
      updated_at = CURRENT_TIMESTAMP
  `).run(colaboradora.id, data, tipo, hora);

  return {
    notFound: false,
    isUpdate: Boolean(existing),
    colaboradora: mapColaboradora(colaboradora),
  };
}

function getGroupedRows(cpf) {
  const normalizedCpf = normalizeCpf(cpf);

  if (normalizedCpf) {
    return db.prepare(`
      SELECT
        c.cpf,
        r.data,
        MAX(CASE WHEN r.tipo = 'entrada' THEN r.hora END) AS entrada,
        MAX(CASE WHEN r.tipo = 'saida_almoco' THEN r.hora END) AS saida_almoco,
        MAX(CASE WHEN r.tipo = 'volta_almoco' THEN r.hora END) AS volta_almoco,
        MAX(CASE WHEN r.tipo = 'saida' THEN r.hora END) AS saida
      FROM registros_ponto r
      INNER JOIN colaboradoras c
        ON c.id = r.colaboradora_id
      WHERE c.cpf = ?
      GROUP BY c.id, r.data
      ORDER BY r.data
    `).all(normalizedCpf);
  }

  return db.prepare(`
    SELECT
      c.cpf,
      r.data,
      MAX(CASE WHEN r.tipo = 'entrada' THEN r.hora END) AS entrada,
      MAX(CASE WHEN r.tipo = 'saida_almoco' THEN r.hora END) AS saida_almoco,
      MAX(CASE WHEN r.tipo = 'volta_almoco' THEN r.hora END) AS volta_almoco,
      MAX(CASE WHEN r.tipo = 'saida' THEN r.hora END) AS saida
    FROM registros_ponto r
    INNER JOIN colaboradoras c
      ON c.id = r.colaboradora_id
    GROUP BY c.id, r.data
    ORDER BY c.nome COLLATE NOCASE, r.data
  `).all();
}

function attachDias(colaboradoras, groupedRows) {
  const reportMap = new Map(
    colaboradoras.map((colaboradora) => [
      colaboradora.cpf,
      {
        ...colaboradora,
        dias: [],
      },
    ]),
  );

  for (const row of groupedRows) {
    if (!row?.cpf || !row?.data) {
      continue;
    }

    const report = reportMap.get(row.cpf);
    if (!report) {
      continue;
    }

    report.dias.push({
      data: row.data,
      entrada: row.entrada || "",
      saida_almoco: row.saida_almoco || "",
      volta_almoco: row.volta_almoco || "",
      saida: row.saida || "",
    });
  }

  return reportMap;
}

function getColaboradorReport(cpf) {
  const colaboradora = findColaboradoraByCpf(cpf);
  if (!colaboradora) {
    return null;
  }

  const reportMap = attachDias([colaboradora], getGroupedRows(cpf));
  return reportMap.get(colaboradora.cpf) ?? {
    ...colaboradora,
    dias: [],
  };
}

function getAllReports() {
  const colaboradoras = listColaboradoras();
  const reportMap = attachDias(colaboradoras, getGroupedRows());
  return colaboradoras.map((colaboradora) => reportMap.get(colaboradora.cpf));
}

initializeSchema();
ensureOptionalSchema();
migrateLegacyDataIfNeeded();

module.exports = {
  authenticateColaboradora,
  DB_PATH,
  deleteColaboradora,
  findColaboradoraByCpf,
  getAllReports,
  getColaboradorReport,
  listColaboradoras,
  normalizeCpf,
  registerPonto,
  upsertColaboradora,
};
