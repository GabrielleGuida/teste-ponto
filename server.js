const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const arquivo = path.join(__dirname, "assets", "registros_pontos.json");

// Registrar ponto
app.post("/registrar-ponto", (req, res) => {
    const novoRegistro = req.body;

    let banco = { registros_ponto: [] };

    if (fs.existsSync(arquivo)) {
        const dados = fs.readFileSync(arquivo);
        banco = JSON.parse(dados);
    }

    let colaborador = banco.registros_ponto.find(c => c.cpf === novoRegistro.cpf);

    if (!colaborador) {
        colaborador = {
            cpf: novoRegistro.cpf,
            nome: novoRegistro.nome,
            dias: []
        };
        banco.registros_ponto.push(colaborador);
    }

    colaborador.dias.push(novoRegistro.dia);

    fs.writeFileSync(arquivo, JSON.stringify(banco, null, 2));

    res.json({ mensagem: "Ponto registrado com sucesso!" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});


const caminhoColaboradoras = path.join(__dirname, "assets", "colaboradoras.json");

app.post("/cadastrar-colaboradora", (req, res) => {

    const nova = req.body;

    let banco = { colaboradoras: [] };

    if (fs.existsSync(caminhoColaboradoras)) {
        const dados = fs.readFileSync(caminhoColaboradoras);
        banco = JSON.parse(dados);
    }

    // Verifica CPF duplicado
    if (banco.colaboradoras.find(c => c.cpf === nova.cpf)) {
        return res.status(400).json({ mensagem: "CPF já cadastrado!" });
    }

    banco.colaboradoras.push(nova);

    fs.writeFileSync(caminhoColaboradoras, JSON.stringify(banco, null, 2));

    res.json({ mensagem: "Colaboradora cadastrada com sucesso!" });
});

const caminhoRegistros = path.join(__dirname, "assets", "registros_pontos.json");

app.get("/relatorio/:cpf", (req, res) => {

    const cpf = req.params.cpf;

    if (!fs.existsSync(caminhoRegistros)) {
        return res.json({ dias: [] });
    }

    const dados = JSON.parse(fs.readFileSync(caminhoRegistros));

    const colaborador = dados.registros_ponto.find(c => c.cpf === cpf);

    if (!colaborador) {
        return res.json({ dias: [] });
    }

    res.json(colaborador);
});


app.get("/relatorio-geral", (req, res) => {

    if (!fs.existsSync(caminhoRegistros)) {
        return res.json({ registros_ponto: [] });
    }

    const dados = JSON.parse(fs.readFileSync(caminhoRegistros));

    res.json(dados);
});


app.get("/dashboard", (req, res) => {

    if (!fs.existsSync(caminhoRegistros)) {
        return res.json({ registros_ponto: [] });
    }

    const dados = JSON.parse(fs.readFileSync(caminhoRegistros));

    res.json(dados);
});
