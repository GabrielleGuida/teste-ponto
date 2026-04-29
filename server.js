const express = require("express");
const path = require("path");
const {
  DB_PATH,
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
        mensagem: "Preencha nome, CPF, horario de inicio, horario de saida e descanso.",
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
