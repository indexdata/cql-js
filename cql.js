var EXPORTED_SYMBOLS = ["CQLParser"];

var DEFAULT_SERVER_CHOICE_FIELD = 'cql.serverChoice';
var DEFAULT_SERVER_CHOICE_RELATION = 'scr';

function indent(n, c) {
    var s = "";
    for (var i = 0; i < n; i++)
        s = s + c;
    return s;
}

var CQLError = function (message, query, pos, look, val, lval) {
    this.name = "CQLError";
    this.message = message;
    // raw query string
    this.query = query;
    // parser (error) position in raw query
    this.pos = pos;
    // state: s | q | | ()/ | <>= | "'
    this.look = look;
    // value of token (may be (quoted) content, "index"; field or term)
    this.val = val;
    // lowercased this.val
    this.lval = lval;
    this.stack = (new Error()).stack;
}
CQLError.prototype = Object.create(Error.prototype);

// CQLModifier
var CQLModifier = function () {
    // name of (relation) modifier
    this.name = null;
    // relation of modifier value (e.g. equals, lower than, etc.)
    this.relation = null;
    // optional value of modifier ("true" if empty)
    this.value = null;
    this._pos = null;
    this._range = null;
}

CQLModifier.prototype = {
    toString: function () {
        return this.name + this.relation + this.value;
    },

    toXCQL: function (n, c) {
        var s = indent(n + 1, c) + "<modifier>\n";
        s = s + indent(n + 2, c) + "<name>" + this.name + "</name>\n";
        if (this.relation != null)
            s = s + indent(n + 2, c)
                + "<relation>" + this.relation + "</relation>\n";
        if (this.value != null)
            s = s + indent(n + 2, c)
                + "<value>" + this.value + "</value>\n";
        s = s + indent(n + 1, c) + "</modifier>\n";
        return s;
    },

    toFQ: function () {
        //we ignore modifier relation symbol, for value-less modifiers
        //we assume 'true'
        var value = this.value.length > 0 ? this.value : "true";
        var s = '"' + this.name + '": "' + value + '"';
        if (this._pos !== null) s += ', "' + this.name + '@pos": ' + this._pos;
        if (this._range !== null) s += ', "' + this.name + '@range": ' + JSON.stringify(this._range);
        return s;
    }
}

// CQLSearchClause
var CQLSearchClause = function (field, fielduri, relation, relationuri,
    modifiers, term, scf, scr) {
    // index or name
    this.field = field;
    // not supported yet? (always empty string)
    this.fielduri = fielduri;
    // relation symbol or string
    this.relation = relation;
    // not supported yet? (always empty string)
    this.relationuri = relationuri;
    // list of modifiers
    this.modifiers = modifiers;
    // value
    this.term = term;
    this.scf = scf || DEFAULT_SERVER_CHOICE_FIELD;
    this.scr = scr || DEFAULT_SERVER_CHOICE_RELATION;
    // start position of search clause
    this._pos = null;
    // range (start + end position) of search clause (without surrounding braces or spaces)
    this._range = null;
    // start position of relation
    this._relpos = null;
}

CQLSearchClause.prototype = {
    toString: function () {
        var field = this.field;
        var relation = this.relation;
        if (field == this.scf && relation == this.scr) {
            //avoid redundant field/relation
            field = null;
            relation = null;
        }
        return (field ? field + ' ' : '') +
            (relation ? relation : '') +
            (this.modifiers.length > 0 ? '/' + this.modifiers.join('/') : '') +
            (relation || this.modifiers.length ? ' ' : '') +
            '"' + this.term + '"';
    },

    toXCQL: function (n, c) {
        var s = indent(n, c) + "<searchClause>\n";
        if (this.fielduri.length > 0) {
            s = s + indent(n + 1, c) + "<prefixes>\n" +
                indent(n + 2, c) + "<prefix>\n" +
                indent(n + 3, c) + "<identifier>" + this.fielduri +
                "</identifier>\n" +
                indent(n + 2, c) + "</prefix>\n" +
                indent(n + 1, c) + "</prefixes>\n";
        }
        s = s + indent(n + 1, c) + "<index>" + this.field + "</index>\n";
        s = s + indent(n + 1, c) + "<relation>\n";
        if (this.relationuri.length > 0) {
            s = s + indent(n + 2, c) +
                "<identifier>" + this.relationuri + "</identifier>\n";
        }
        s = s + indent(n + 2, c) + "<value>" + this.relation + "</value>\n";
        if (this.modifiers.length > 0) {
            s = s + indent(n + 2, c) + "<modifiers>\n";
            for (var i = 0; i < this.modifiers.length; i++)
                s = s + this.modifiers[i].toXCQL(n + 2, c);
            s = s + indent(n + 2, c) + "</modifiers>\n";
        }
        s = s + indent(n + 1, c) + "</relation>\n";
        s = s + indent(n + 1, c) + "<term>" + this.term + "</term>\n";
        s = s + indent(n, c) + "</searchClause>\n";
        return s;
    },

    toFQ: function () {
        var s = '{"term": "' + this.term + '"';
        if (this.field.length > 0 && this.field != this.scf)
            s += ', "field": "' + this.field + '"';
        if (this.relation.length > 0 && this.relation != this.scr)
            s += ', "relation": "' + this._mapRelation(this.relation) + '"';
        for (var i = 0; i < this.modifiers.length; i++) {
            //since modifiers are mapped to keys, ignore the reserved ones
            if (this.modifiers[i].name == "term"
                || this.modifiers[i].name == "field"
                || this.modifiers[i].name == "relation")
                continue;
            s += ', ' + this.modifiers[i].toFQ();
        }
        if (this._pos !== null) s += ', "@pos": ' + this._pos;
        if (this._range !== null) s += ', "@range": ' + JSON.stringify(this._range);
        if (this._relpos !== null) s += ', "relation@pos": ' + this._relpos;
        s += '}';
        return s;
    },

    _mapRelation: function (rel) {
        switch (rel) {
            case "<": return "lt";
            case ">": return "gt";
            case "=": return "eq";
            case "<>": return "ne";
            case ">=": return "ge";
            case "<=": return "le";
            default: return rel;
        }
    },

    _remapRelation: function (rel) {
        switch (rel) {
            case "lt": return "<";
            case "gt": return ">";
            case "eq": return "=";
            case "ne": return "<>";
            case "ge": return ">=";
            case "le": return "<=";
            default: return rel;
        }
    }
}

// CQLBoolean
var CQLBoolean = function () {
    // operator: and | or | not | prox
    this.op = null;
    // list of modifiers
    this.modifiers = null;
    // left search clause
    this.left = null;
    // right search clause
    this.right = null;
    this._pos = null;
    this._range = null;
}

CQLBoolean.prototype = {
    toString: function () {
        return (this.left.op ? '(' + this.left + ')' : this.left) + ' ' +
            this.op.toUpperCase() +
            (this.modifiers.length > 0 ? '/' + this.modifiers.join('/') : '') +
            ' ' + (this.right.op ? '(' + this.right + ')' : this.right);;
    },

    toXCQL: function (n, c) {
        var s = indent(n, c) + "<triple>\n";
        s = s + indent(n + 1, c) + "<boolean>\n" +
            indent(n + 2, c) + "<value>" + this.op + "</value>\n";
        if (this.modifiers.length > 0) {
            s = s + indent(n + 2, c) + "<modifiers>\n";
            for (var i = 0; i < this.modifiers.length; i++)
                s = s + this.modifiers[i].toXCQL(n + 2, c);
            s = s + indent(n + 2, c) + "</modifiers>\n";
        }
        s = s + indent(n + 1, c) + "</boolean>\n";
        s = s + indent(n + 1, c) + "<leftOperand>\n" +
            this.left.toXCQL(n + 2, c) + indent(n + 1, c) + "</leftOperand>\n";

        s = s + indent(n + 1, c) + "<rightOperand>\n" +
            this.right.toXCQL(n + 2, c) + indent(n + 1, c) + "</rightOperand>\n";
        s = s + indent(n, c) + "</triple>\n";
        return s;
    },

    toFQ: function (n, c, nl) {
        var s = '{"op": "' + this.op + '"';
        //proximity modifiers
        for (var i = 0; i < this.modifiers.length; i++)
            s += ', ' + this.modifiers[i].toFQ();
        s += ',' + nl + indent(n, c) + ' "s1": ' + this.left.toFQ(n + 1, c, nl);
        s += ',' + nl + indent(n, c) + ' "s2": ' + this.right.toFQ(n + 1, c, nl);
        if (this._pos !== null) s += ',' + nl + indent(n, c) + ' "@pos": ' + this._pos;
        if (this._range !== null) s += ',' + nl + indent(n, c) + ' "@range": ' + JSON.stringify(this._range);
        var fill = n && c ? ' ' : '';
        s += nl + indent(n - 1, c) + fill + '}';
        return s;
    }

}

// CQLParser
var CQLParser = function () {
    // index/position in raw query
    this.qi = null;
    // raw query string length (char count)
    this.ql = null;
    // raw query string
    this.qs = null;
    // parser state: s | q | ()/ | <>= | "'
    // if empty string then error
    this.look = null;
    // lowercased this.val
    this.lval = null;
    // value of token (may be (quoted) content, "index"; field or term)
    this.val = null;
    // (internal) start position of expression
    this._exprStart = null;
    // (internal) start position of relation (in expression)
    this._exprRelStart = null;
    this.prefixes = new Object();
    // parsed query
    this.tree = null;
    this.scf = null;
    this.scr = null;
}

CQLParser.prototype = {
    parse: function (query, scf, scr) {
        if (!query)
            throw new CQLError("The query to be parsed cannot be empty", this.qs);
        this.scf = typeof scf != 'string'
            ? DEFAULT_SERVER_CHOICE_FIELD : scf;
        this.scr = typeof scr != 'string'
            ? DEFAULT_SERVER_CHOICE_RELATION : scr;
        this.qs = query;
        this.ql = this.qs.length;
        this.qi = 0;
        this.lval = this.val = this._exprStart = null;
        this._move();
        this.tree = this._parseQuery(this.scf, this.scr, new Array());
        if (this.look != "")
            throw new CQLError("EOF expected", this.qs, this.qi, this.look, this.val, this.lval);
    },
    parseFromFQ: function (query, scf, scr) {
        if (!query)
            throw new CQLError("The query to be parsed cannot be empty", this.qs);
        if (typeof query == 'string')
            query = JSON.parse(query);
        this.scf = typeof scf != 'string'
            ? DEFAULT_SERVER_CHOICE_FIELD : scf;
        this.scr = typeof scr != 'string'
            ? DEFAULT_SERVER_CHOICE_RELATION : scr;
        this.tree = this._parseFromFQ(query);
    },
    _parseFromFQ: function (fq) {
        //op-node
        if (fq.hasOwnProperty('op')
            && fq.hasOwnProperty('s1')
            && fq.hasOwnProperty('s2')) {
            var node = new CQLBoolean();
            node.op = fq.op;
            node.left = this._parseFromFQ(fq.s1);
            node.right = this._parseFromFQ(fq.s2);
            //include all other members as modifiers
            node.modifiers = [];
            for (var key in fq) {
                if (key == 'op' || key == 's1' || key == 's2')
                    continue;
                if (key.endsWith("@pos") || key.endsWith("@range"))
                    continue;
                var mod = new CQLModifier();
                mod.name = key;
                mod.relation = '=';
                mod.value = fq[key];
                node.modifiers.push(mod);
            }
            return node;
        }
        //search-clause node
        if (fq.hasOwnProperty('term')) {
            var node = new CQLSearchClause();
            node.term = fq.term;
            node.scf = this.scf;
            node.scr = this.scr;
            node.field = fq.hasOwnProperty('field')
                ? fq.field : this.scf;
            node.relation = fq.hasOwnProperty('relation')
                ? node._remapRelation(fq.relation) : this.scr;
            //include all other members as modifiers
            node.relationuri = '';
            node.fielduri = '';
            node.modifiers = [];
            for (var key in fq) {
                if (key == 'term' || key == 'field' || key == 'relation')
                    continue;
                if (key.endsWith("@pos") || key.endsWith("@range"))
                    continue;
                var mod = new CQLModifier();
                mod.name = key;
                mod.relation = '=';
                mod.value = fq[key];
                node.modifiers.push(mod);
            }
            return node;
        }
        throw new CQLError('Unknow node type; ' + JSON.stringify(fq), this.qs, this.qi, this.look, this.val, this.lval);
    },
    toXCQL: function (c) {
        c = typeof c == "undefined" ? ' ' : c;
        return this.tree.toXCQL(0, c);
    },
    toFQ: function (c, nl) {
        c = typeof c == "undefined" ? '  ' : c;
        nl = typeof nl == "undefined" ? '\n' : c;
        return this.tree.toFQ(0, c, nl);
    },
    toString: function () {
        return this.tree.toString();
    },
    _parseQuery: function (field, relation, modifiers) {
        var left = this._parseSearchClause(field, relation, modifiers);
        while (this.look == "s" && (
            this.lval == "and" ||
            this.lval == "or" ||
            this.lval == "not" ||
            this.lval == "prox")) {
            var b = new CQLBoolean();
            b._pos = this.qi - this.lval.length + 1;
            b.op = this.lval;
            this._move();
            b.modifiers = this._parseModifiers();
            b._range = [b._pos, Math.max(b._pos + b.op.length - 1, Math.max.apply(null, b.modifiers.map(x => ("_range" in x) ? x._range[1]: 0)))];
            b.left = left;
            b.right = this._parseSearchClause(field, relation, modifiers);
            left = b;
        }
        return left;
    },
    _parseModifiers: function () {
        var ar = new Array();
        let _safeExprStart = this._exprStart;
        let _safeExprRelStart = this._exprRelStart;
        while (this.look == "/") {
            let _mstart = this.qi;
            this._move();
            if (this.look != "s" && this.look != "q")
                throw new CQLError("Invalid modifier.", this.qs, this.qi, this.look, this.val, this.lval)

            var name = this.lval;
            let _mpos = this.qi - this.lval.length + 1;
            let _mend = this.qi;
            this._move();
            if (this.look.length > 0
                && this._strchr("<>=", this.look.charAt(0))) {
                var rel = this.look;
                this._move();
                _mend = this.qi;
                if (this.look != "s" && this.look != "q")
                    throw new CQLError("Invalid relation within the modifier.", this.qs, this.qi, this.look, this.val, this.lval);

                var m = new CQLModifier();
                m._pos = _mpos;
                m._range = [_mstart, _mend];
                this._exprStart = null;
                m.name = name;
                m.relation = rel;
                m.value = this.val;
                ar.push(m);
                this._move();
            } else {
                var m = new CQLModifier();
                m._pos = _mpos;
                m._range = [_mstart, _mend];
                this._exprStart = null;
                m.name = name;
                m.relation = "";
                m.value = "";
                ar.push(m);
            }
        }
        this._exprStart = _safeExprStart;
        this._exprRelStart = _safeExprRelStart;
        return ar;
    },
    _parseSearchClause: function (field, relation, modifiers) {
        if (this.look == "(") {
            let _qi = this.qi;
            this._move();
            var b = this._parseQuery(field, relation, modifiers);
            if (this.look == ")")
                this._move();
            else
                throw new CQLError("Missing closing parenthesis.", this.qs, _qi, this.look, this.val, this.lval);

            return b;
        } else if (this.look == "s" || this.look == "q") {
            var first = this.val;   // dont know if field or term yet
            if (this._exprStart === null)
                this._exprStart = this.qi - this.val.length + 1;
            let _tend = this.qi;
            this._move();
            if (this.look == "q" ||
                (this.look == "s" &&
                    this.lval != "and" &&
                    this.lval != "or" &&
                    this.lval != "not" &&
                    this.lval != "prox")) {
                var rel = this.val;    // string relation
                this._exprRelStart = this.qi - this.val.length + 1;
                this._move();
                return this._parseSearchClause(first, rel,
                    this._parseModifiers());
            } else if (this.look.length > 0
                && this._strchr("<>=", this.look.charAt(0))) {
                var rel = this.look;   // other relation <, = ,etc
                this._move();
                return this._parseSearchClause(first, rel,
                    this._parseModifiers());
            } else {
                // it's a search term
                var pos = field.indexOf('.');
                var pre = "";
                if (pos != -1)
                    pre = field.substring(0, pos);

                var uri = this._lookupPrefix(pre);
                if (uri.length > 0)
                    field = field.substring(pos + 1);

                pos = relation.indexOf('.');
                if (pos == -1)
                    pre = "cql";
                else
                    pre = relation.substring(0, pos);

                var reluri = this._lookupPrefix(pre);
                if (reluri.Length > 0)
                    relation = relation.Substring(pos + 1);

                var sc = new CQLSearchClause(field,
                    uri,
                    relation,
                    reluri,
                    modifiers,
                    first,
                    this.scf,
                    this.scr);
                sc._range = [this._exprStart, _tend];
                sc._relpos = this._exprRelStart;
                this._exprStart = this._exprRelStart = null;
                return sc;
            }
            // prefixes
        } else if (this.look == ">") {
            this._move();
            if (this.look != "s" && this.look != "q")
                throw new CQLError("Expecting string or a quoted expression.", this.qs, this.qi, this.look, this.val, this.lval);

            var first = this.lval;
            this._move();
            if (this.look == "=") {
                this._move();
                if (this.look != "s" && this.look != "q")
                    throw new CQLError("Expecting string or a quoted expression.", this.qs, this.qi, this.look, this.val, this.lval);

                this._addPrefix(first, this.lval);
                this._move();
                return this._parseQuery(field, relation, modifiers);
            } else {
                this._addPrefix("default", first);
                return this._parseQuery(field, relation, modifiers);
            }
        } else {
            throw new CQLError("Invalid search clause.", this.qs, this.qi, this.look, this.val, this.lval);
        }

    },
    _move: function () {
        //eat whitespace
        while (this.qi < this.ql
            && this._strchr(" \t\r\n", this.qs.charAt(this.qi)))
            this.qi++;
        //eof
        if (this.qi == this.ql) {
            this.look = "";
            return;
        }
        //current char
        var c = this.qs.charAt(this.qi);
        //separators
        if (this._strchr("()/", c)) {
            this.look = c;
            this.qi++;
            //comparitor
        } else if (this._strchr("<>=", c)) {
            this.look = c;
            this.qi++;
            this._exprRelStart = this.qi;
            //comparitors can repeat, could be if
            while (this.qi < this.ql
                && this._strchr("<>=", this.qs.charAt(this.qi))) {
                this.look = this.look + this.qs.charAt(this.qi);
                this.qi++;
            }
            //quoted string
        } else if (this._strchr("\"'", c)) {
            if (this._exprStart === null)
                this._exprStart = this.qi + 1;
            this.look = "q";
            //remember quote char
            var mark = c;
            this.qi++;
            this.val = "";
            var escaped = false;
            while (this.qi < this.ql) {
                if (!escaped && this.qs.charAt(this.qi) == mark)
                    break;
                if (!escaped && this.qs.charAt(this.qi) == '\\')
                    escaped = true;
                else
                    escaped = false;
                this.val += this.qs.charAt(this.qi);
                this.qi++;
            }
            this.lval = this.val.toLowerCase();
            if (this.qi < this.ql)
                this.qi++;
            else //unterminated
                this.look = ""; //notify error
            //unquoted string
        } else {
            this.look = "s";
            this.val = "";
            while (this.qi < this.ql
                && !this._strchr("()/<>= \t\r\n", this.qs.charAt(this.qi))) {
                this.val = this.val + this.qs.charAt(this.qi);
                this.qi++;
            }
            this.lval = this.val.toLowerCase();
        }
    },
    _strchr: function (s, ch) {
        return s.indexOf(ch) >= 0
    },
    _lookupPrefix: function (name) {
        return this.prefixes[name] ? this.prefixes[name] : "";
    },
    _addPrefix: function (name, value) {
        //overwrite existing items
        this.prefixes[name] = value;
    }
}

// for module import systems uncomment the following line
// module.exports = CQLParser;
