const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
// Aumentar o limite para suportar o envio de descritores faciais se necessário (embora sejam pequenos)
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Servir a pasta node_modules para que o frontend acesse o face-api.js
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));
// Servir a pasta models
app.use('/models', express.static(path.join(__dirname, 'models')));

const arquivo = path.join(__dirname, "assets", "registros_pontos.json");
const caminhoColaboradoras = path.join(__dirname, "assets", "colaboradoras.json");

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

app.post("/cadastrar-colaboradora", (req, res) => {
    const nova = req.body;

    let banco = { colaboradoras: [] };

    if (fs.existsSync(caminhoColaboradoras)) {
        const dados = fs.readFileSync(caminhoColaboradoras);
        banco = JSON.parse(dados);
    }

    // Verifica CPF duplicado
    const indexExistente = banco.colaboradoras.findIndex(c => c.cpf === nova.cpf);
    if (indexExistente !== -1) {
        // Se já existe, vamos atualizar (útil para recadastrar face)
        banco.colaboradoras[indexExistente] = { ...banco.colaboradoras[indexExistente], ...nova };
        fs.writeFileSync(caminhoColaboradoras, JSON.stringify(banco, null, 2));
        return res.json({ mensagem: "Cadastro atualizado com sucesso!" });
    }

    banco.colaboradoras.push(nova);
    fs.writeFileSync(caminhoColaboradoras, JSON.stringify(banco, null, 2));

    res.json({ mensagem: "Colaboradora cadastrada com sucesso!" });
});

app.get("/relatorio/:cpf", (req, res) => {
    const cpf = req.params.cpf;

    if (!fs.existsSync(arquivo)) {
        return res.json({ dias: [] });
    }

    const dados = JSON.parse(fs.readFileSync(arquivo));
    const colaborador = dados.registros_ponto.find(c => c.cpf === cpf);

    if (!colaborador) {
        return res.json({ dias: [] });
    }

    res.json(colaborador);
});

app.get("/relatorio-geral", (req, res) => {
    if (!fs.existsSync(arquivo)) {
        return res.json({ registros_ponto: [] });
    }
    const dados = JSON.parse(fs.readFileSync(arquivo));
    res.json(dados);
});

app.get("/dashboard", (req, res) => {
    if (!fs.existsSync(arquivo)) {
        return res.json({ registros_ponto: [] });
    }
    const dados = JSON.parse(fs.readFileSync(arquivo));
    res.json(dados);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
