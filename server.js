const express = require("express");
const path = require("path");
const {
  authenticateColaboradora,
  DB_PATH,
  deleteColaboradora,
  findColaboradoraByCpf,
  getAllReports,
  getColaboradorReport,
  listColaboradoras,
  registerPonto,
  upsertColaboradora,
} = require("./database");

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use("/data", (_req, res) => res.status(404).end());
app.use(express.static(__dirname));
app.use("/node_modules", express.static(path.join(__dirname, "node_modules")));
app.use("/models", express.static(path.join(__dirname, "models")));

function extractRegistroPayload(body = {}) {
  if (body?.dia) {
    return {
      cpf: body.cpf,
      tipo: body.dia.tipo,
      data: body.dia.data,
      hora: body.dia.hora,
    };
  }

  return body;
}

app.get("/api/colaboradoras", (_req, res) => {
  res.json({ colaboradoras: listColaboradoras() });
});

app.get("/api/colaboradoras/:cpf", (req, res) => {
  const colaboradora = findColaboradoraByCpf(req.params.cpf, {
    includeFaceDescriptor: true,
  });

  if (!colaboradora) {
    return res.status(404).json({ mensagem: "Colaboradora nao encontrada." });
  }

  return res.json(colaboradora);
});

app.delete("/api/colaboradoras/:cpf", (req, res) => {
  try {
    const resultado = deleteColaboradora(req.params.cpf);

    if (resultado.notFound) {
      return res.status(404).json({ mensagem: "Colaboradora nao encontrada." });
    }

    return res.json({
      mensagem: "Colaboradora apagada com sucesso!",
      colaboradora: resultado.colaboradora,
    });
  } catch (error) {
    if (error.message === "INVALID_CPF") {
      return res.status(400).json({ mensagem: "Informe um CPF valido para apagar a colaboradora." });
    }

    console.error("Erro ao apagar colaboradora:", error);
    return res.status(500).json({ mensagem: "Erro interno ao apagar colaboradora." });
  }
});

app.post("/api/login-colaboradora", (req, res) => {
  try {
    const resultado = authenticateColaboradora(req.body);

    if (resultado.notFound || resultado.invalidPassword) {
      return res.status(401).json({ mensagem: "CPF ou senha invalidos." });
    }

    if (resultado.missingPassword) {
      return res.status(403).json({
        mensagem: "Esta colaboradora ainda nao possui senha cadastrada. Solicite o cadastro da senha ao admin.",
      });
    }

    return res.json({
      mensagem: "Login realizado com sucesso!",
      colaboradora: resultado.colaboradora,
    });
  } catch (error) {
    if (error.message === "INVALID_LOGIN_PAYLOAD") {
      return res.status(400).json({
        mensagem: "Informe CPF e senha validos para entrar.",
      });
    }

    console.error("Erro ao autenticar colaboradora:", error);
    return res.status(500).json({ mensagem: "Erro interno ao autenticar colaboradora." });
  }
});

app.post(["/api/cadastrar-colaboradora", "/cadastrar-colaboradora"], (req, res) => {
  try {
    const resultado = upsertColaboradora(req.body);
    return res.json({
      mensagem: resultado.isUpdate
        ? "Cadastro atualizado com sucesso!"
        : "Colaboradora cadastrada com sucesso!",
      colaboradora: resultado.colaboradora,
    });
  } catch (error) {
    if (error.message === "INVALID_COLABORADORA_PAYLOAD") {
      return res.status(400).json({
        mensagem: "Preencha nome, CPF, senha, horario de inicio, horario de saida e descanso.",
      });
    }

    console.error("Erro ao cadastrar colaboradora:", error);
    return res.status(500).json({ mensagem: "Erro interno ao salvar colaboradora." });
  }
});

app.post(["/api/registrar-ponto", "/registrar-ponto"], (req, res) => {
  try {
    const resultado = registerPonto(extractRegistroPayload(req.body));

    if (resultado.notFound) {
      return res.status(404).json({ mensagem: "Colaboradora nao encontrada." });
    }

    return res.json({
      mensagem: resultado.isUpdate
        ? "Ponto atualizado com sucesso!"
        : "Ponto registrado com sucesso!",
      colaboradora: resultado.colaboradora,
    });
  } catch (error) {
    if (error.message === "INVALID_REGISTRO_PAYLOAD") {
      return res.status(400).json({
        mensagem: "Informe CPF, data, tipo e hora validos para registrar o ponto.",
      });
    }

    console.error("Erro ao registrar ponto:", error);
    return res.status(500).json({ mensagem: "Erro interno ao registrar ponto." });
  }
});

app.get(["/api/relatorio/:cpf", "/relatorio/:cpf"], (req, res) => {
  const colaboradora = getColaboradorReport(req.params.cpf);

  if (!colaboradora) {
    return res.json({ dias: [] });
  }

  return res.json(colaboradora);
});

app.get(["/api/relatorio-geral", "/relatorio-geral"], (_req, res) => {
  return res.json({ registros_ponto: getAllReports() });
});

app.get(["/api/dashboard", "/dashboard"], (_req, res) => {
  return res.json({ registros_ponto: getAllReports() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Banco SQLite em: ${DB_PATH}`);
});
